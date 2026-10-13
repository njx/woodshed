#!/usr/bin/env bash
# Builds the playback samples in public/samples/ from the tonejs-instruments recordings
# (https://github.com/nbrosowsky/tonejs-instruments, MIT) — and the walking bass's from the Fluid R3
# General MIDI soundfont's acoustic bass, as rendered by midi-js-soundfonts
# (https://github.com/gleitz/midi-js-soundfonts, CC BY 3.0): one note every 3 semitones or so,
# leading silence removed, trimmed to a few seconds with a fade, loudness-matched, mono 64 kbps.
# Also writes src/data/sounds.json listing the notes. Needs npm and ffmpeg.
# With instrument ids as arguments (e.g. `scripts/make-samples.sh bass`), builds just those.
# Remade recordings need a new address for phones that already have the old ones: bump the
# sound's REVISION in src/sounds.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# id  npm package (or fluid/<instrument>)  seconds  lowest–highest MIDI note kept
# (C2–C7 is plenty for exercises and covers the horns; the bass, for the walking bass, E1–C4: an
# upright, plucked, ringing on into the next note.)
INSTRUMENTS="piano:tonejs-instrument-piano-mp3:2.5:36:96
sax:tonejs-instrument-saxophone-mp3:3:36:96
trumpet:tonejs-instrument-trumpet-mp3:3:36:96
flute:tonejs-instrument-flute-mp3:3:36:96
clarinet:tonejs-instrument-clarinet-mp3:3:36:96
guitar:tonejs-instrument-guitar-electric-mp3:2.5:36:96
bass:fluid/acoustic_bass:2.5:28:60"

midi() { # note name like Cs4 / Bb1 / A2 → MIDI number
  local n=$1 letter=${1:0:1} sharp=0 oct
  [[ ${n:1:1} == s ]] && sharp=1
  [[ ${n:1:1} == b ]] && sharp=-1
  oct=${n: -1}
  declare -A base=([C]=0 [D]=2 [E]=4 [F]=5 [G]=7 [A]=9 [B]=11)
  echo $(( (oct + 1) * 12 + ${base[$letter]} + sharp ))
}

mkdir -p public/samples
while IFS=: read -r id pkg secs lo hi; do
  [[ $# -gt 0 && " $* " != *" $id "* ]] && continue
  rm -rf "public/samples/$id"
  if [[ $pkg == fluid/* ]]; then
    # Every note from E0 to C6, from the soundfont's rendering (flats in the names: Db, Eb…).
    mkdir -p "$work/$id/package"
    for o in 0 1 2 3 4 5; do for l in C Db D Eb E F Gb G Ab A Bb B; do
      m=$(midi "$l$o"); (( m >= lo && m <= hi )) || continue
      curl -sSf -o "$work/$id/package/$l$o.mp3" \
        "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/${pkg#fluid/}-mp3/$l$o.mp3"
    done; done
  else
    (cd "$work" && npm pack "$pkg" --silent >/dev/null </dev/null && mkdir -p "$id" && tar xzf "$pkg"-*.tgz -C "$id")
  fi
  mkdir -p "public/samples/$id"
  # Sort the available notes by pitch; keep one at least 3 semitones above the last kept.
  picked=()
  last=-100
  for m in $(for f in "$work/$id"/package/*.mp3; do echo "$(midi "$(basename "$f" .mp3)") $f"; done | sort -n | cut -d' ' -f1); do
    if (( m >= lo && m <= hi && m - last >= 3 )); then picked+=("$m"); last=$m; fi
  done
  for f in "$work/$id"/package/*.mp3; do
    m=$(midi "$(basename "$f" .mp3)")
    [[ " ${picked[*]} " == *" $m "* ]] || continue
    fade=$(echo "$secs - 0.4" | bc)
    ffmpeg -nostdin -loglevel error -y -i "$f" -ac 1 -ar 44100 \
      -af "silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:$secs,afade=t=out:st=$fade:d=0.4,loudnorm=I=-20:TP=-2" \
      -c:a libmp3lame -b:a 64k "public/samples/$id/$m.mp3"
  done
done <<< "$INSTRUMENTS"
# The notes there are, from what's in public/samples (in the order above).
echo '{' > src/data/sounds.json
first=1
while IFS=: read -r id _; do
  [[ -d "public/samples/$id" ]] || continue
  notes=$(ls "public/samples/$id" | sed 's/\.mp3$//' | sort -n | paste -sd, -)
  [[ $first == 1 ]] || echo ',' >> src/data/sounds.json
  first=0
  printf '  "%s": [%s]' "$id" "$notes" >> src/data/sounds.json
done <<< "$INSTRUMENTS"
printf '\n}\n' >> src/data/sounds.json
du -sh public/samples/*

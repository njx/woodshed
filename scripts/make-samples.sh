#!/usr/bin/env bash
# Builds the playback samples in public/samples/ from the tonejs-instruments recordings
# (https://github.com/nbrosowsky/tonejs-instruments, MIT): one note every 3 semitones or so,
# leading silence removed, trimmed to a few seconds with a fade, loudness-matched, mono 64 kbps.
# Also writes src/data/sounds.json listing the notes. Needs npm and ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# id  npm package                        seconds
INSTRUMENTS="piano:tonejs-instrument-piano-mp3:2.5
sax:tonejs-instrument-saxophone-mp3:3
trumpet:tonejs-instrument-trumpet-mp3:3
flute:tonejs-instrument-flute-mp3:3
clarinet:tonejs-instrument-clarinet-mp3:3
guitar:tonejs-instrument-guitar-electric-mp3:2.5"

midi() { # note name like Cs4 / A2 → MIDI number
  local n=$1 letter=${1:0:1} sharp=0 oct
  [[ ${n:1:1} == s ]] && sharp=1
  oct=${n: -1}
  declare -A base=([C]=0 [D]=2 [E]=4 [F]=5 [G]=7 [A]=9 [B]=11)
  echo $(( (oct + 1) * 12 + ${base[$letter]} + sharp ))
}

rm -rf public/samples && mkdir -p public/samples
echo '{' > src/data/sounds.json
first=1
while IFS=: read -r id pkg secs; do
  (cd "$work" && npm pack "$pkg" --silent >/dev/null </dev/null && mkdir -p "$id" && tar xzf "$pkg"-*.tgz -C "$id")
  mkdir -p "public/samples/$id"
  # Sort the available notes by pitch; keep one at least 3 semitones above the last kept.
  picked=()
  last=-100
  for m in $(for f in "$work/$id"/package/*.mp3; do echo "$(midi "$(basename "$f" .mp3)") $f"; done | sort -n | cut -d' ' -f1); do
    # C2–C7 is plenty for exercises (and covers the horns' ranges).
    if (( m >= 36 && m <= 96 && m - last >= 3 )); then picked+=("$m"); last=$m; fi
  done
  for f in "$work/$id"/package/*.mp3; do
    m=$(midi "$(basename "$f" .mp3)")
    [[ " ${picked[*]} " == *" $m "* ]] || continue
    fade=$(echo "$secs - 0.4" | bc)
    ffmpeg -nostdin -loglevel error -y -i "$f" -ac 1 -ar 44100 \
      -af "silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:$secs,afade=t=out:st=$fade:d=0.4,loudnorm=I=-20:TP=-2" \
      -c:a libmp3lame -b:a 64k "public/samples/$id/$m.mp3"
  done
  [[ $first == 1 ]] || echo ',' >> src/data/sounds.json
  first=0
  printf '  "%s": [%s]' "$id" "$(IFS=,; echo "${picked[*]}")" >> src/data/sounds.json
done <<< "$INSTRUMENTS"
printf '\n}\n' >> src/data/sounds.json
du -sh public/samples/*

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
while IFS= read -r url; do
  curl -fsS --max-time 30 "$url" -o /tmp/orca-original-image
  curl -fsS --max-time 30 "$url?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp" -o /tmp/orca-direct-image
  curl -fsS --max-time 30 --get --data-urlencode "url=$url" https://server-1.barbel-hops.ts.net:18974/_model-thumbnail/v300 -o /tmp/orca-relay-image
  original=$(identify -format '%w %h' '/tmp/orca-original-image[0]')
  direct=$(identify -format '%w %h' '/tmp/orca-direct-image[0]')
  relay=$(identify -format '%w %h' '/tmp/orca-relay-image[0]')
  echo "$url original=$original direct=$direct relay=$relay"
  read -r ow oh <<< "$original"; read -r dw dh <<< "$direct"; read -r rw rh <<< "$relay"
  awk -v ow="$ow" -v oh="$oh" -v w="$rw" -v h="$rh" 'BEGIN { e=h-w*oh/ow; if(w>300 || h>300 || e>1.1 || e< -1.1) exit 1 }'
  if [[ "$url" != *.jfif ]]; then
    awk -v ow="$ow" -v oh="$oh" -v w="$dw" -v h="$dh" 'BEGIN { e=h-w*oh/ow; if(w>300 || h>300 || e>1.1 || e< -1.1) exit 1 }'
  fi
done < wasm/reports/credentialless-live-20261118/image-urls.txt

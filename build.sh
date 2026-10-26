#!/bin/bash
set -euo pipefail

# Собирает zen-tweaks.xpi и открывает его в Zen: тот спросит, ставить ли расширение.
# Нужны настройки профиля xpinstall.signatures.required = false
# и extensions.experiments.enabled = true.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Куда класть пакет; release.yml передаёт свой путь
OUT="${OUT:-/tmp/zen-tweaks.xpi}"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$ROOT/extension" && zip -q -X -r "$OUT" . -x '.*' '*/.*')
echo "Собрано: $OUT"

if [[ "${1:-}" == "--install" ]]; then
  open -a Zen "$OUT"
fi

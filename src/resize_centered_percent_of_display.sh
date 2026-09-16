#!/usr/bin/env bash
set -euo pipefail

mode="${1:-on}"
percentage="${2:-70}"

case "$mode" in
	on|off) ;;
	*)
		echo "usage: $(basename "$0") [on|off] [percentage]" >&2
		exit 2
		;;
esac

if ! [[ "$percentage" =~ ^[0-9]+$ ]] || [ "$percentage" -lt 1 ] || [ "$percentage" -gt 100 ]; then
	echo "percentage must be an integer from 1 to 100" >&2
	exit 2
fi

# This helper is intentionally geometry-only. It should resize/move the current
# window without toggling it into or out of floating mode so it can be reused for
# future math-driven resize workflows.
display_frame="$(yabai -m query --displays --display | jq -c '.frame')"
read -r display_x display_y display_width display_height < <(
	jq -r '[.x, .y, .w, .h] | @tsv' <<<"$display_frame"
)

if [ "$mode" = "on" ]; then
	# Square mode uses the shorter display dimension as its reference.
	read -r width height x y < <(jq -nr \
		--argjson display_width "$display_width" --argjson display_height "$display_height" \
		--argjson percentage "$percentage" --argjson x "$display_x" --argjson y "$display_y" \
		'([($display_width * $percentage / 100), ($display_height * $percentage / 100)] | min | floor) as $side |
		 [$side, $side, ($x + (($display_width - $side) / 2) | floor), ($y + (($display_height - $side) / 2) | floor)] | @tsv')
else
	# Rectangle mode preserves the original grid behavior: percentage of each axis.
	read -r width height x y < <(jq -nr \
		--argjson display_width "$display_width" --argjson display_height "$display_height" \
		--argjson percentage "$percentage" --argjson x "$display_x" --argjson y "$display_y" \
		'($display_width * $percentage / 100 | floor) as $width |
		 ($display_height * $percentage / 100 | floor) as $height |
		 [$width, $height, ($x + (($display_width - $width) / 2) | floor), ($y + (($display_height - $height) / 2) | floor)] | @tsv')
fi

yabai -m window --resize "abs:$width:$height"
yabai -m window --move "abs:$x:$y"
sketchybar --trigger window_focus

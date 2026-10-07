#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <file1.gcode> <file2.gcode>" >&2
    exit 2
fi

FILE1="$1"
FILE2="$2"

if [ ! -f "$FILE1" ]; then
    echo "Error: file not found: $FILE1" >&2
    exit 2
fi

if [ ! -f "$FILE2" ]; then
    echo "Error: file not found: $FILE2" >&2
    exit 2
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

NORM1="$TMP_DIR/norm1.gcode"
NORM2="$TMP_DIR/norm2.gcode"

normalize_gcode() {
    local src="$1"
    local dst="$2"

    tr -d '\r' < "$src" | awk '
    BEGIN { in_thumb = 0; in_btt = 0 }
    /;[ \t]*(THUMBNAIL_BLOCK_START|thumbnail.*begin)/ { in_thumb = 1; next }
    in_thumb {
        if (/;[ \t]*(THUMBNAIL_BLOCK_END|thumbnail.*end)/) in_thumb = 0
        next
    }
    /^[ \t]*;[0-9a-fA-F]{8}[ \t]*$/ { in_btt = 1; next }
    in_btt {
        if (/;[ \t]*bigtree thumbnail end/) in_btt = 0
        next
    }
    {
        sub(/[ \t]*;.*$/, "")
        sub(/^[ \t]+/, "")
        sub(/[ \t]+$/, "")
        if ($0 == "") next
        if ($0 ~ /^EXCLUDE_OBJECT/) next
        if ($0 ~ /^M73([ \t]|$)/) next
        gsub(/[ \t]+/, " ")
        print
    }
    ' > "$dst"
}

normalize_gcode "$FILE1" "$NORM1"
normalize_gcode "$FILE2" "$NORM2"

summarize_file() {
    local orig="$1"
    local norm="$2"

    local lc
    lc=$(grep -c '^[[:space:]]*;LAYER_CHANGE' "$orig" 2>/dev/null || true)
    if [ "$lc" -eq 0 ]; then
        lc=$(grep -c '^[[:space:]]*;Z:' "$orig" 2>/dev/null || true)
    fi

    awk -v file="$orig" -v layers="$lc" '
    BEGIN {
        g1_count = 0
        total_e = 0
        has_x = has_y = has_z = 0
    }
    /^G1([ \t]|$)/ {
        g1_count++
        for (i = 2; i <= NF; i++) {
            code = substr($i, 1, 1)
            val = substr($i, 2) + 0
            if (code == "E") {
                total_e += val
            } else if (code == "X") {
                if (!has_x || val < min_x) min_x = val
                if (!has_x || val > max_x) max_x = val
                has_x = 1
            } else if (code == "Y") {
                if (!has_y || val < min_y) min_y = val
                if (!has_y || val > max_y) max_y = val
                has_y = 1
            } else if (code == "Z") {
                if (!has_z || val < min_z) min_z = val
                if (!has_z || val > max_z) max_z = val
                has_z = 1
            }
        }
    }
    END {
        print "Summary for " file ":"
        printf "  Layers: %d\n", layers
        printf "  G1 moves: %d\n", g1_count
        printf "  Total extrusion: %.4f\n", total_e
        if (has_x) printf "  X range: min %.3f, max %.3f\n", min_x, max_x
        else printf "  X range: N/A\n"
        if (has_y) printf "  Y range: min %.3f, max %.3f\n", min_y, max_y
        else printf "  Y range: N/A\n"
        if (has_z) printf "  Z range: min %.3f, max %.3f\n", min_z, max_z
        else printf "  Z range: N/A\n"
    }
    ' "$norm"
}

summarize_file "$FILE1" "$NORM1"
echo ""
summarize_file "$FILE2" "$NORM2"
echo ""

# Requirement 3: Print the number of differing normalized lines (diff | grep -c '^[<>]') and the first 20 differing lines.
DIFF_COUNT=$(diff "$NORM1" "$NORM2" | grep -c '^[<>]' || true)

echo "Differing normalized lines: $DIFF_COUNT"
if [ "$DIFF_COUNT" -gt 0 ]; then
    echo "First differing lines (up to 20):"
    diff "$NORM1" "$NORM2" | grep '^[<>]' | head -n 20 || true
fi

# Requirement 4: Exit 0 if identical, 1 if differ only within numeric tolerance (0.001), 2 otherwise.
if [ "$DIFF_COUNT" -eq 0 ]; then
    exit 0
fi

L1=$(wc -l < "$NORM1" | tr -d ' ')
L2=$(wc -l < "$NORM2" | tr -d ' ')

if [ "$L1" -ne "$L2" ]; then
    exit 2
fi

TOL_EXIT=0
paste -d '\t' "$NORM1" "$NORM2" | awk -F '\t' '
BEGIN {
    diff_count = 0
    all_within_tol = 1
}
{
    l1 = $1
    l2 = $2
    if (l1 == l2) next

    diff_count++
    n1 = split(l1, w1, " ")
    n2 = split(l2, w2, " ")
    if (n1 != n2 || w1[1] != w2[1]) {
        all_within_tol = 0
        exit
    }
    for (i = 2; i <= n1; i++) {
        if (w1[i] == w2[i]) continue

        m1 = match(w1[i], /[-+]?([0-9]+\.[0-9]*|[0-9]*\.[0-9]+|[0-9]+)([eE][-+]?[0-9]+)?$/)
        if (!m1) {
            all_within_tol = 0
            exit
        }
        p1 = substr(w1[i], 1, RSTART - 1)
        v1 = substr(w1[i], RSTART, RLENGTH) + 0

        m2 = match(w2[i], /[-+]?([0-9]+\.[0-9]*|[0-9]*\.[0-9]+|[0-9]+)([eE][-+]?[0-9]+)?$/)
        if (!m2) {
            all_within_tol = 0
            exit
        }
        p2 = substr(w2[i], 1, RSTART - 1)
        v2 = substr(w2[i], RSTART, RLENGTH) + 0

        if (p1 != p2) {
            all_within_tol = 0
            exit
        }

        diff = v1 - v2
        if (diff < 0) diff = -diff
        if (diff - 0.001 > 1e-7) {
            all_within_tol = 0
            exit
        }
    }
}
END {
    if (diff_count == 0) exit 0
    if (all_within_tol == 1) exit 1
    exit 2
}
' || TOL_EXIT=$?

exit "$TOL_EXIT"

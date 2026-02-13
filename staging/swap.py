#!/usr/bin/env python3
"""
Song Arranger — Pin & Randomize

- Pin specific songs to specific days (by day number or date like 2/14/26)
- Pins are saved to song_pins.json by PID (unique per song, survives reshuffling)
- Every run: pinned songs stay fixed, ALL unpinned slots are re-randomized
- Writes the final arranged calendar back to calendar_data.js
"""

import json
import sys
import os
import random
import copy
from datetime import date, datetime, timedelta


# ── Configure these ───────────────────────────────────────────────────────────
PRELOADED_FILE_PATH = "C:/VCU/zzz/isabella_shortcuts/valentines_calender/threesixtyfive/staging/assets/calendar_data.js"
START_DATE          = date(2026, 2, 14)   # Day 1 of your calendar
# ─────────────────────────────────────────────────────────────────────────────


# ── File I/O ──────────────────────────────────────────────────────────────────

def pins_path(js_file):
    return os.path.join(os.path.dirname(os.path.abspath(js_file)), "song_pins.json")


def load_data(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if file_path.lower().endswith(".js"):
        start = raw.index("{")
        end   = raw.rindex("}") + 1
        return json.loads(raw[start:end]), raw[:start], raw[end:]
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f), None, None


def save_data(file_path, data, js_prefix=None, js_suffix=None):
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write((js_prefix or "") + json_str + (js_suffix or ""))


def load_pins(js_file):
    """
    Returns dict { "14": "PID_STRING", ... }
    Keys are day numbers (as strings), values are song PIDs.
    """
    p = pins_path(js_file)
    if os.path.isfile(p):
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_pins(js_file, pins):
    p = pins_path(js_file)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(pins, f, indent=2)


# ── Date helpers ──────────────────────────────────────────────────────────────

def date_to_day_num(s):
    s = s.strip()
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            parsed = datetime.strptime(s, fmt).date()
            delta  = (parsed - START_DATE).days + 1
            if delta < 1:
                raise ValueError(
                    f"{parsed.strftime('%B %d, %Y')} is before the calendar start "
                    f"({START_DATE.strftime('%B %d, %Y')})."
                )
            return delta, parsed
        except ValueError as e:
            if "before the calendar" in str(e):
                raise
    raise ValueError(f"Cannot parse '{s}'. Use M/D/YY or M/D/YYYY, e.g. 2/14/26.")


def day_label(day_num):
    d = START_DATE + timedelta(days=day_num - 1)
    return f"Day {day_num} ({d.strftime('%B %d, %Y')})"


def parse_target(raw, total_days):
    raw = raw.strip()
    if "/" in raw:
        n, parsed = date_to_day_num(raw)
        if n > total_days:
            raise ValueError(f"Maps to Day {n} but calendar only has {total_days} days.")
        return n, f"Day {n} ({parsed.strftime('%B %d, %Y')})"
    if raw.isdigit():
        n = int(raw)
        if not 1 <= n <= total_days:
            raise ValueError(f"Day must be between 1 and {total_days}.")
        return n, day_label(n)
    raise ValueError(f"'{raw}' is not a valid day number or date (e.g. 14 or 2/14/26).")


# ── Song helpers ──────────────────────────────────────────────────────────────

SONG_FIELDS = ["src", "song_embed", "PID", "metadata"]


def song_payload(entry):
    """Extract just the song data fields from a day entry."""
    return {f: entry.get(f) for f in SONG_FIELDS}


def song_summary(entry):
    m = entry.get("metadata", {})
    return f"'{m.get('original_name', '?')}' by {m.get('original_artist', '?')}"


def pid_of(entry):
    return entry.get("PID")


def build_pid_index(data):
    """Returns { PID: day_key } for every entry in data."""
    return {entry.get("PID"): k for k, entry in data.items() if entry.get("PID")}


def find_song(data, query):
    """Case-insensitive partial name match. Returns (day_key, entry) or (None, None)."""
    q = query.strip().lower()
    matches = [
        (k, v) for k, v in data.items()
        if q in v.get("metadata", {}).get("original_name", "").lower()
        or q in v.get("metadata", {}).get("matched_name", "").lower()
    ]
    if not matches:
        return None, None
    if len(matches) == 1:
        return matches[0]

    print(f"\n  Multiple matches for '{query}':")
    for i, (k, v) in enumerate(matches, 1):
        n = int(k.replace("day", ""))
        print(f"    [{i}] Day {n}: {song_summary(v)}")
    while True:
        c = input("  Pick a number: ").strip()
        if c.isdigit() and 1 <= int(c) <= len(matches):
            return matches[int(c) - 1]
        print("  Invalid choice.")


# ── Core: apply pins + randomize ──────────────────────────────────────────────

def apply_pins_and_randomize(data, pins):
    """
    pins = { "14": "PID_ABC123", ... }

    Pins are looked up by PID so they survive previous randomizations.
    Pinned songs go to their designated days; all others are shuffled
    into the remaining slots.
    """
    total    = len(data)
    all_keys = [f"day{i}" for i in range(1, total + 1)]

    # Snapshot every song payload, indexed by PID
    pid_to_payload = {}
    for k in all_keys:
        entry = data[k]
        pid   = pid_of(entry)
        if pid:
            pid_to_payload[pid] = song_payload(entry)

    # Resolve pins: { day_num (int): payload }
    pinned_day_payloads = {}
    pinned_pids         = set()

    for day_str, pid in pins.items():
        day_num = int(day_str)
        if f"day{day_num}" not in data:
            print(f"  ⚠️  Skipping pin: Day {day_num} not in calendar.")
            continue
        if pid not in pid_to_payload:
            print(f"  ⚠️  Skipping pin for Day {day_num}: song PID '{pid}' not found.")
            continue
        pinned_day_payloads[day_num] = pid_to_payload[pid]
        pinned_pids.add(pid)

    # Unpinned pool = all songs whose PID is not pinned, shuffled
    unpinned = [p for pid, p in pid_to_payload.items() if pid not in pinned_pids]
    random.shuffle(unpinned)
    unpinned_iter = iter(unpinned)

    # Build new data
    new_data = copy.deepcopy(data)
    for i in range(1, total + 1):
        dest_key = f"day{i}"
        payload  = pinned_day_payloads.get(i) or next(unpinned_iter)
        for f in SONG_FIELDS:
            new_data[dest_key][f] = payload[f]

    return new_data


# ── Menus ─────────────────────────────────────────────────────────────────────

def show_pins(pins, data):
    if not pins:
        print("\n  No pins set yet.")
        return
    pid_index = build_pid_index(data)
    print("\n  Current pins:")
    for day_str, pid in sorted(pins.items(), key=lambda x: int(x[0])):
        day_num  = int(day_str)
        src_key  = pid_index.get(pid)
        entry    = data.get(src_key, {}) if src_key else {}
        print(f"    {day_label(day_num):38s}  ←  {song_summary(entry)}")


def add_pin(data, pins):
    total = len(data)
    print()

    while True:
        raw = input("  Target day (number or date, e.g. 14 or 2/14/26): ").strip()
        try:
            day_num, label = parse_target(raw, total)
            break
        except ValueError as e:
            print(f"  ⚠️  {e}")

    existing_pid = pins.get(str(day_num))
    if existing_pid:
        pid_index = build_pid_index(data)
        old_entry = data.get(pid_index.get(existing_pid, ""), {})
        print(f"  ℹ️  {label} already pinned to {song_summary(old_entry)}. Will overwrite.")

    query = input("  Song name to pin there: ").strip()
    if not query:
        print("  Cancelled.")
        return

    src_key, src_entry = find_song(data, query)
    if src_key is None:
        print(f"  ❌  No song found matching '{query}'.")
        return

    new_pid = pid_of(src_entry)
    if not new_pid:
        print("  ❌  This song has no PID and cannot be pinned.")
        return

    # Check if this PID is already pinned to a different day
    for d, p in list(pins.items()):
        if p == new_pid and int(d) != day_num:
            print(f"  ⚠️  That song is already pinned to {day_label(int(d))}.")
            over = input("  Move pin to new day instead? (y/n): ").strip().lower()
            if over == "y":
                del pins[d]
            else:
                print("  Cancelled.")
                return
            break

    pins[str(day_num)] = new_pid
    print(f"  ✅  Pinned: {song_summary(src_entry)}  →  {label}")


def remove_pin(pins, data):
    if not pins:
        print("\n  No pins to remove.")
        return
    show_pins(pins, data)
    print()
    raw = input("  Enter day number or date to unpin: ").strip()
    try:
        day_num, label = parse_target(raw, len(data))
    except ValueError as e:
        print(f"  ⚠️  {e}")
        return
    key = str(day_num)
    if key not in pins:
        print(f"  ℹ️  No pin set for {label}.")
        return
    pid_index = build_pid_index(data)
    old_entry = data.get(pid_index.get(pins[key], ""), {})
    del pins[key]
    print(f"  ✅  Unpinned {label}  (was: {song_summary(old_entry)})")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("     🎵  Song Arranger — Pin & Randomize  🎵")
    print("=" * 60)
    print(f"  Calendar start: {START_DATE.strftime('%B %d, %Y')}  (= Day 1)\n")

    file_path = PRELOADED_FILE_PATH.strip() or input("Path to calendar_data.js: ").strip()
    if not os.path.isfile(file_path):
        print(f"❌  File not found: {file_path}")
        sys.exit(1)

    data, js_prefix, js_suffix = load_data(file_path)
    pins = load_pins(file_path)
    print(f"✅  Loaded {len(data)} songs.  📌 {len(pins)} pin(s) active.\n")

    while True:
        print("─" * 40)
        print("  [1]  Add / update a pin")
        print("  [2]  Remove a pin")
        print("  [3]  View all pins")
        print("  [4]  Apply pins + randomize unpinned  →  save to calendar_data.js")
        print("  [5]  Exit without saving")
        print()
        choice = input("  Choice: ").strip()

        if choice == "1":
            add_pin(data, pins)
            save_pins(file_path, pins)

        elif choice == "2":
            remove_pin(pins, data)
            save_pins(file_path, pins)

        elif choice == "3":
            show_pins(pins, data)

        elif choice == "4":
            show_pins(pins, data)
            print(f"\n  Randomizing {len(data) - len(pins)} unpinned slot(s)...")
            confirm = input("  Proceed and save? (y/n): ").strip().lower()
            if confirm != "y":
                print("  Cancelled.")
                continue
            new_data = apply_pins_and_randomize(data, pins)
            save_data(file_path, new_data, js_prefix, js_suffix)
            print(f"  ✅  Saved to: {file_path}")
            data, js_prefix, js_suffix = load_data(file_path)

        elif choice == "5":
            print("  Bye!")
            sys.exit(0)

        else:
            print("  Please enter 1–5.")
        print()


if __name__ == "__main__":
    main()
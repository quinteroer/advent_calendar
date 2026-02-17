#!/usr/bin/env python3
"""
Comprehensive Song Calendar Manager

PART 1: Build the calendar from iTunes/Music library
PART 2: Pin & Randomize songs in the calendar

This script combines both workflows into one tool.
"""

import requests
import plistlib
import json
import unicodedata
import re
import time
import os
import random
import sys
import copy
from datetime import date, datetime, timedelta
from pathlib import Path

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

LIBRARY_FILENAME = "365_library.xml"
PLAYLIST_NAME = "PID:BBE2197D42966E62"  # Use PID: prefix to search by Persistent ID
CHECKPOINT_FILE = "progress_checkpoint.json"
FINAL_FILE = "assets/calendar_data.js"
SKIPPED_SONGS_FILE = "skipped_songs.json"
PINS_FILE = "song_pins.json"
EXPECTED_DAYS = 365
START_DATE = date(2026, 2, 14)  # Day 1 of your calendar

# ══════════════════════════════════════════════════════════════════════════════
# PART 1: CALENDAR BUILDER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def find_library_file():
    """Cross-platform library file finder"""
    possible_paths = [
        Path.home() / "Music" / LIBRARY_FILENAME,
        Path.home() / "Music" / "iTunes" / LIBRARY_FILENAME,
        Path.home() / "Music" / "Music" / "Library" / LIBRARY_FILENAME,
        Path(LIBRARY_FILENAME),  # Current directory
    ]
    
    for path in possible_paths:
        if path.exists():
            print(f"✅ Found library: {path}")
            return str(path)
    
    print("❌ Could not find library file automatically.")
    manual_path = input(f"Please enter the full path to {LIBRARY_FILENAME}: ").strip()
    if Path(manual_path).exists():
        return manual_path
    raise FileNotFoundError(f"Library file not found: {manual_path}")


def normalize(text):
    """Improved normalization that preserves more characters"""
    if not text:
        return ""
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = text.replace(" ", "-")
    text = re.sub(r'[^a-z0-9\-]', '', text)
    text = re.sub(r'-+', '-', text).strip('-')
    return text


def parse_playlist_to_dicts(xml_path, playlist_name):
    """Parse playlist with duplicate detection - uses the playlist with most songs if multiple matches
    
    If playlist_name starts with 'PID:', it's treated as a Persistent ID lookup instead.
    Example: 'PID:BBE2197D42966E62' will find the playlist with that exact PID.
    """
    with open(xml_path, 'rb') as f:
        plist = plistlib.load(f)

    tracks = plist['Tracks']
    
    # Check if we're searching by PID instead of name
    search_by_pid = playlist_name.startswith('PID:')
    
    if search_by_pid:
        target_pid = playlist_name[4:]  # Remove 'PID:' prefix
        print(f"🔍 Searching for playlist with Persistent ID: {target_pid}")
        
        # Find playlist by PID
        found_playlist = None
        for pl in plist['Playlists']:
            if pl.get('Playlist Persistent ID') == target_pid:
                found_playlist = pl
                break
        
        if not found_playlist:
            raise ValueError(f"Could not find playlist with Persistent ID: {target_pid}")
        
        playlist_name_found = found_playlist.get('Name', 'Unknown')
        target_items = found_playlist.get('Playlist Items', [])
        print(f"✅ Found playlist: '{playlist_name_found}' with {len(target_items)} songs")
        
    else:
        # Original name-based search logic
        matching_playlists = []
        for pl in plist['Playlists']:
            current_pl_name = str(pl.get('Name', '')).strip()
            if current_pl_name == playlist_name:
                playlist_items = pl.get('Playlist Items', [])
                matching_playlists.append({
                    'name': current_pl_name,
                    'items': playlist_items,
                    'count': len(playlist_items)
                })
        
        if not matching_playlists:
            raise ValueError(f"Could not find any playlist named: {playlist_name}")
        
        # Use the playlist with the most songs
        if len(matching_playlists) > 1:
            print(f"⚠️  Found {len(matching_playlists)} playlists named '{playlist_name}':")
            for i, pl in enumerate(matching_playlists, 1):
                print(f"    Playlist {i}: {pl['count']} songs")
            matching_playlists.sort(key=lambda x: x['count'], reverse=True)
            print(f"✅ Using playlist with {matching_playlists[0]['count']} songs (most songs)")
        
        target_items = matching_playlists[0]['items']
        print(f"✅ Found playlist with {len(target_items)} songs.")
    
    playlist_data = []
    seen_pids = set()
    
    for item in target_items:
        track_id = str(item['Track ID'])
        song_info = tracks.get(track_id)
        if song_info:
            pid = song_info.get('Persistent ID', 'Unknown PID')
            
            if pid in seen_pids:
                print(f"⚠️  Duplicate found: {song_info.get('Name')} - skipping")
                continue
            
            seen_pids.add(pid)
            song_dict = {
                "name": song_info.get('Name', 'Unknown'),
                "artist": song_info.get('Artist', 'Unknown Artist'),
                "album": song_info.get('Album', 'Unknown Album'),
                "PID": pid
            }
            playlist_data.append(song_dict)
    
    return playlist_data


def get_apple_music_id(song_name, artist_name, album_name, retry_count=0):
    """Improved API call with better matching and error handling"""
    query = f"{song_name} {artist_name}".replace(" ", "+")
    url = f"https://itunes.apple.com/search?term={query}&entity=song&limit=10"
    
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'
    ]
    headers = { 'User-Agent': random.choice(user_agents) }
    
    try:
        response = requests.get(url, headers=headers, timeout=20)

        if response.status_code == 429 or response.status_code == 403:
            if retry_count >= 5:
                print(f"  ❌ Failed after 5 retries")
                return {"error": "rate_limit_exceeded", "id": None}
            
            wait_time = min(300, (2 ** retry_count) * 30)
            print(f"  ⚠️  Rate limited! Waiting {wait_time}s... (attempt {retry_count + 1}/5)")
            time.sleep(wait_time)
            return get_apple_music_id(song_name, artist_name, album_name, retry_count + 1)

        if response.status_code != 200:
            return {"error": f"http_{response.status_code}", "id": None}
        
        data = response.json()
        
        if data.get('resultCount', 0) == 0:
            return {"error": "no_results", "id": None}
        
        results = data['results']
        
        norm_song = song_name.lower().strip()
        norm_artist = artist_name.lower().strip()
        norm_album = album_name.lower().strip()
        
        best_match = None
        best_score = 0
        
        for result in results:
            api_song = result.get('trackName', '').lower().strip()
            api_artist = result.get('artistName', '').lower().strip()
            api_album = result.get('collectionName', '').lower().strip()
            
            score = 0
            
            if api_song == norm_song:
                score += 10
            elif norm_song in api_song or api_song in norm_song:
                score += 5
            
            if api_artist == norm_artist:
                score += 5
            elif norm_artist in api_artist or api_artist in norm_artist:
                score += 2
            
            if api_album == norm_album:
                score += 3
            elif norm_album in api_album or api_album in norm_album:
                score += 1
            
            if score > best_score:
                best_score = score
                best_match = result
        
        if best_match:
            match_quality = "High Confidence" if best_score >= 15 else "Medium Confidence" if best_score >= 8 else "Low Confidence"
            return {
                "id": best_match.get('trackId'),
                "official_name": best_match.get('trackName'),
                "official_artist": best_match.get('artistName'),
                "official_album": best_match.get('collectionName'),
                "match_quality": match_quality,
                "match_score": best_score
            }
        
        return {
            "id": results[0].get('trackId'),
            "official_name": results[0].get('trackName'),
            "official_artist": results[0].get('artistName'),
            "official_album": results[0].get('collectionName'),
            "match_quality": "Fallback",
            "match_score": 0
        }
        
    except requests.Timeout:
        print(f"  ⚠️  Timeout - retrying...")
        if retry_count < 3:
            time.sleep(5)
            return get_apple_music_id(song_name, artist_name, album_name, retry_count + 1)
        return {"error": "timeout", "id": None}
    except Exception as e:
        print(f"  ⚠️  Error: {type(e).__name__}: {e}")
        return {"error": str(e), "id": None}


def convert_to_links(name, id):
    """Generate Apple Music embed with proper escaping"""
    name = normalize(name)
    url = f'<iframe allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="175" style="width:100%;max-width:660px;overflow:hidden;border-radius:10px;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" src="https://embed.music.apple.com/us/song/{name}/{id}"></iframe>'
    return url


def get_src_link(name, id):
    name = normalize(name)
    src = f'https://embed.music.apple.com/us/song/{name}/{id}'
    return src


def validate_embed(url):
    """Basic validation of embed code"""
    return 'embed.music.apple.com' in url and url.startswith('<iframe')


def load_checkpoint():
    """Load checkpoint with error handling"""
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print("⚠️  Checkpoint file corrupted, starting fresh")
            return {}
    return {}


def save_checkpoint(data):
    """Save checkpoint atomically"""
    temp_file = CHECKPOINT_FILE + ".tmp"
    try:
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, CHECKPOINT_FILE)
    except Exception as e:
        print(f"⚠️  Error saving checkpoint: {e}")
        if os.path.exists(temp_file):
            os.remove(temp_file)


def save_skipped_songs(skipped_list):
    """Save list of skipped songs for manual review"""
    try:
        with open(SKIPPED_SONGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(skipped_list, f, indent=2, ensure_ascii=False)
        print(f"📝 Saved {len(skipped_list)} skipped songs to {SKIPPED_SONGS_FILE}")
    except Exception as e:
        print(f"⚠️  Error saving skipped songs: {e}")


def validate_calendar(json_data, expected_days):
    """Validate that calendar has consecutive days"""
    missing_days = []
    for i in range(1, expected_days + 1):
        if f"day{i}" not in json_data:
            missing_days.append(i)
    
    if missing_days:
        print(f"\n⚠️  WARNING: Missing {len(missing_days)} days:")
        print(f"   {missing_days[:10]}{'...' if len(missing_days) > 10 else ''}")
        return False
    
    print(f"\n✅ Calendar validated: All {expected_days} days present!")
    return True


def save_to_js(song_data, filename=FINAL_FILE):
    """Save with proper backup and validation"""
    if os.path.exists(filename):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = filename.replace('.js', f'_backup_{timestamp}.js')
        try:
            import shutil
            shutil.copy2(filename, backup_name)
            print(f"  📦 Backup saved: {backup_name}")
        except Exception as e:
            print(f"  ⚠️  Couldn't create backup: {e}")
            response = input("Continue without backup? (y/n): ")
            if response.lower() != 'y':
                raise

    json_string = json.dumps(song_data, indent=4, ensure_ascii=False)
    js_content = f"const loveData = {json_string};"
    
    try:
        temp_file = filename + ".tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(js_content)
        
        with open(temp_file, "r", encoding="utf-8") as f:
            content = f.read()
            if not content.startswith("const loveData = "):
                raise ValueError("Generated file has incorrect format")
        
        os.replace(temp_file, filename)
        print(f"✅ Saved {filename} with {len(song_data)} songs!")
    except Exception as e:
        print(f"❌ Error saving file: {e}")
        if os.path.exists(temp_file):
            os.remove(temp_file)
        raise


def build_calendar():
    """Main calendar building function - PART 1"""
    print("\n" + "="*80)
    print("🎵 PART 1: Building Calendar from iTunes/Music Library")
    print("="*80 + "\n")
    
    try:
        file_path = find_library_file()
    except FileNotFoundError as e:
        print(f"❌ {e}")
        return False
    
    try:
        song_list = parse_playlist_to_dicts(file_path, PLAYLIST_NAME)
    except Exception as e:
        print(f"❌ Error parsing playlist: {e}")
        return False
    
    print(f"\n📊 Playlist has {len(song_list)} unique songs")
    print(f"📅 Target: {EXPECTED_DAYS} days\n")
    
    # Try to load existing calendar data first
    json_data = {}
    if os.path.exists(FINAL_FILE):
        try:
            print(f"📂 Loading existing calendar from {FINAL_FILE}...")
            data, _, _ = load_data(FINAL_FILE)
            json_data = data
            print(f"✅ Loaded {len(json_data)} existing days")
        except Exception as e:
            print(f"⚠️  Could not load existing calendar: {e}")
            print("   Starting fresh...")
    
    # Fall back to checkpoint if calendar file didn't work
    if not json_data:
        json_data = load_checkpoint()
    
    existing_days = len(json_data)
    skipped_songs = []
    
    if existing_days > 0:
        print(f"📂 Resuming from day {existing_days + 1}\n")
    
    print(f"{'Day':<6} | {'Name':<30} | {'Artist':<25} | {'Match Quality':<18} | {'ID':<12}")
    print("-" * 105)
    
    api_call_count = 0
    
    try:
        for day_num in range(existing_days + 1, EXPECTED_DAYS + 1):
            song_index = day_num - 1
            
            if song_index >= len(song_list):
                print(f"\n⚠️  Ran out of songs! Only have {len(song_list)} songs for {EXPECTED_DAYS} days")
                break
            
            song = song_list[song_index]
            
            if api_call_count > 0 and api_call_count % 25 == 0:
                long_break = random.randint(45, 90)
                print(f"\n☕ API call #{api_call_count} - Taking a {long_break}s break...\n")
                time.sleep(long_break)
            
            id_data = get_apple_music_id(song['name'], song['artist'], song['album'])
            api_call_count += 1
            
            if id_data and id_data.get('id'):
                song_id = id_data['id']
                match_quality = id_data.get('match_quality', 'Unknown')
                
                src = get_src_link(song['name'], song_id)
                url = convert_to_links(song['name'], song_id)
                
                if not validate_embed(url):
                    print(f"Day {day_num:<3} | {song['name'][:28]:<30} | ❌ Invalid embed generated")
                    skipped_songs.append({
                        "day": day_num,
                        "song": song,
                        "reason": "invalid_embed"
                    })
                    continue
                
                details = {
                    "title": f"Day {day_num}",
                    "message": "",
                    "src": src,
                    "song_embed": url,
                    "PID": song['PID'],
                    "metadata": {
                        "original_name": song['name'],
                        "original_artist": song['artist'],
                        "matched_name": id_data.get('official_name'),
                        "matched_artist": id_data.get('official_artist'),
                        "match_quality": match_quality
                    }
                }
                json_data[f"day{day_num}"] = details
                
                name_short = song['name'][:28]
                artist_short = song['artist'][:23]
                print(f"Day {day_num:<3} | {name_short:<30} | {artist_short:<25} | {match_quality:<18} | {song_id}")
                
            else:
                error_reason = id_data.get('error', 'unknown') if id_data else 'unknown'
                print(f"Day {day_num:<3} | {song['name'][:28]:<30} | ❌ Failed: {error_reason}")
                skipped_songs.append({
                    "day": day_num,
                    "song": song,
                    "reason": error_reason
                })
                continue
            
            if day_num % 10 == 0:
                save_checkpoint(json_data)
                print(f"💾 Checkpoint: Day {day_num} saved")
            
            if day_num < EXPECTED_DAYS:
                wait_time = random.uniform(3.0, 6.5)
                time.sleep(wait_time)

    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted! Saving progress...")
        save_checkpoint(json_data)
        if skipped_songs:
            save_skipped_songs(skipped_songs)
        save_to_js(json_data, FINAL_FILE)
        print(f"💾 Saved {len(json_data)} days")
        return False
    
    save_checkpoint(json_data)
    save_to_js(json_data, FINAL_FILE)
    
    if skipped_songs:
        save_skipped_songs(skipped_songs)
    
    print("\n" + "="*105)
    validate_calendar(json_data, EXPECTED_DAYS)
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Successful: {len(json_data)} days")
    print(f"   ❌ Skipped: {len(skipped_songs)} songs")
    print(f"   🔧 API calls made: {api_call_count}")
    
    if len(json_data) < EXPECTED_DAYS:
        print(f"\n⚠️  Need {EXPECTED_DAYS - len(json_data)} more songs!")
        print(f"   Check {SKIPPED_SONGS_FILE} for manual fixes")
        return False
    
    return True


def show_remaining_songs():
    """Show which songs from playlist are not yet in the calendar"""
    print("\n" + "="*80)
    print("📋 Remaining Songs Analysis")
    print("="*80 + "\n")
    
    # Load library and parse playlist
    try:
        file_path = find_library_file()
        song_list = parse_playlist_to_dicts(file_path, PLAYLIST_NAME)
        print(f"✅ Found {len(song_list)} songs in playlist\n")
    except Exception as e:
        print(f"❌ Error loading playlist: {e}")
        return
    
    # Load calendar data
    if not os.path.exists(FINAL_FILE):
        print(f"❌ Calendar file not found: {FINAL_FILE}")
        print("   Build the calendar first!")
        return
    
    try:
        data, _, _ = load_data(FINAL_FILE)
        print(f"✅ Loaded calendar with {len(data)} days\n")
    except Exception as e:
        print(f"❌ Error loading calendar: {e}")
        return
    
    # Get PIDs from calendar
    calendar_pids = set()
    for day_key, day_data in data.items():
        pid = day_data.get('PID')
        if pid:
            calendar_pids.add(pid)
    
    # Find songs not in calendar
    remaining_songs = []
    for i, song in enumerate(song_list, 1):
        if song['PID'] not in calendar_pids:
            remaining_songs.append({
                'position': i,
                'name': song['name'],
                'artist': song['artist'],
                'album': song['album'],
                'PID': song['PID']
            })
    
    # Display results
    print("="*80)
    if not remaining_songs:
        print("🎉 All songs from the playlist are in the calendar!")
    else:
        print(f"📊 {len(remaining_songs)} songs NOT yet in calendar (out of {len(song_list)} total)\n")
        print(f"{'#':<5} | {'Song Name':<35} | {'Artist':<30}")
        print("-" * 80)
        for song in remaining_songs:
            name_short = song['name'][:33]
            artist_short = song['artist'][:28]
            print(f"{song['position']:<5} | {name_short:<35} | {artist_short:<30}")
    
    print("="*80)
    print(f"\n✅ Songs in calendar: {len(calendar_pids)}/{len(song_list)}")
    print(f"⏳ Remaining to add: {len(remaining_songs)}")
    
    # Save to file
    if remaining_songs:
        remaining_file = "remaining_songs.json"
        try:
            with open(remaining_file, 'w', encoding='utf-8') as f:
                json.dump(remaining_songs, f, indent=2, ensure_ascii=False)
            print(f"📝 Saved remaining songs list to {remaining_file}")
        except Exception as e:
            print(f"⚠️  Could not save remaining songs file: {e}")
    
    input("\nPress Enter to continue...")


def clean_calendar_from_playlist():
    """Remove songs from calendar that are not in the current playlist"""
    print("\n" + "="*80)
    print("🧹 Clean Calendar - Remove Songs Not in Playlist")
    print("="*80 + "\n")
    
    # Load library and parse playlist
    try:
        file_path = find_library_file()
        song_list = parse_playlist_to_dicts(file_path, PLAYLIST_NAME)
        print(f"✅ Found {len(song_list)} songs in playlist\n")
    except Exception as e:
        print(f"❌ Error loading playlist: {e}")
        return
    
    # Load calendar data
    if not os.path.exists(FINAL_FILE):
        print(f"❌ Calendar file not found: {FINAL_FILE}")
        print("   Build the calendar first!")
        return
    
    try:
        data, js_prefix, js_suffix = load_data(FINAL_FILE)
        print(f"✅ Loaded calendar with {len(data)} days\n")
    except Exception as e:
        print(f"❌ Error loading calendar: {e}")
        return
    
    # Create a set of (name, artist) tuples from playlist for matching
    # This handles cases where PIDs change but the song is the same
    def normalize_for_match(text):
        """Normalize text for matching - lowercase and strip whitespace"""
        return text.lower().strip() if text else ""
    
    playlist_songs = set()
    playlist_pid_map = {}  # Map (name, artist) -> new PID for updating
    
    for song in song_list:
        name_norm = normalize_for_match(song['name'])
        artist_norm = normalize_for_match(song['artist'])
        key = (name_norm, artist_norm)
        playlist_songs.add(key)
        playlist_pid_map[key] = song['PID']
    
    # Find songs in calendar that are NOT in playlist (by name+artist)
    # Also track songs that need PID updates
    songs_to_remove = []
    songs_to_update_pid = []
    
    for day_key, day_data in data.items():
        metadata = day_data.get('metadata', {})
        cal_name = metadata.get('original_name', '?')
        cal_artist = metadata.get('original_artist', '?')
        cal_pid = day_data.get('PID')
        
        # Normalize for matching
        name_norm = normalize_for_match(cal_name)
        artist_norm = normalize_for_match(cal_artist)
        key = (name_norm, artist_norm)
        
        # Check if song exists in playlist
        if key not in playlist_songs:
            # Song not found in playlist - mark for removal
            songs_to_remove.append({
                'day': day_key,
                'name': cal_name,
                'artist': cal_artist,
                'PID': cal_pid
            })
        else:
            # Song exists - check if PID needs updating
            new_pid = playlist_pid_map.get(key)
            if new_pid and new_pid != cal_pid:
                songs_to_update_pid.append({
                    'day': day_key,
                    'name': cal_name,
                    'artist': cal_artist,
                    'old_PID': cal_pid,
                    'new_PID': new_pid
                })
    
    # Display results
    if not songs_to_remove and not songs_to_update_pid:
        print("✅ All songs in calendar match the playlist perfectly - nothing to do!")
        input("\nPress Enter to continue...")
        return
    
    # Show songs that will be removed
    if songs_to_remove:
        print(f"⚠️  Found {len(songs_to_remove)} songs in calendar that are NOT in playlist:\n")
        print(f"{'Day':<8} | {'Song Name':<35} | {'Artist':<30}")
        print("-" * 80)
        for song in songs_to_remove:
            day_num = song['day'].replace('day', '')
            name_short = song['name'][:33]
            artist_short = song['artist'][:28]
            print(f"{day_num:<8} | {name_short:<35} | {artist_short:<30}")
            print(f"         PID: {song['PID']}")
    
    # Show songs that need PID updates
    if songs_to_update_pid:
        print(f"\n✨ Found {len(songs_to_update_pid)} songs with updated PIDs (will be fixed):\n")
        print(f"{'Day':<8} | {'Song Name':<35} | {'Artist':<30}")
        print("-" * 80)
        for song in songs_to_update_pid:
            day_num = song['day'].replace('day', '')
            name_short = song['name'][:33]
            artist_short = song['artist'][:28]
            print(f"{day_num:<8} | {name_short:<35} | {artist_short:<30}")
            print(f"         Old PID: {song['old_PID']}")
            print(f"         New PID: {song['new_PID']}")
    
    print("="*80)
    print(f"\n📊 Calendar stats:")
    print(f"   • Total days in calendar: {len(data)}")
    print(f"   • Unique songs in playlist: {len(song_list)}")
    if songs_to_remove:
        print(f"   • Songs to remove: {len(songs_to_remove)}")
        print(f"   • Songs that will remain: {len(data) - len(songs_to_remove)}")
    if songs_to_update_pid:
        print(f"   • Songs with PID updates: {len(songs_to_update_pid)}")
    
    # Show verification option
    print("\nOptions:")
    action_text = "Proceed with "
    actions = []
    if songs_to_remove:
        actions.append("deletion and renumbering")
    if songs_to_update_pid:
        actions.append("PID updates")
    action_text += " and ".join(actions)
    
    print(f"  [1] {action_text}")
    print("  [2] Show me which songs ARE in the playlist (verify)")
    print("  [3] Cancel")
    
    choice = input("\nChoice (1-3): ").strip()
    
    if choice == "2":
        # Verification mode - show first 10 songs in playlist
        print("\n" + "="*80)
        print("First 20 songs in your playlist (for verification):")
        print("="*80)
        for i, song in enumerate(song_list[:20], 1):
            print(f"{i:3}. {song['name'][:40]:40} - {song['artist'][:30]:30}")
            print(f"     PID: {song['PID']}")
        if len(song_list) > 20:
            print(f"\n... and {len(song_list) - 20} more songs")
        input("\nPress Enter to continue...")
        return
    
    if choice != "1":
        print("Cancelled - no changes made.")
        return
    
    # Confirm action
    if songs_to_remove:
        print("\n⚠️  NOTE: Days will be automatically renumbered after removal.")
        print("   For example, if day 2 is removed, day 3 becomes day 2, etc.")
    
    confirm_msg = "UPDATE" if not songs_to_remove else "DELETE"
    confirm = input(f"\nAre you absolutely sure? Type '{confirm_msg}' to confirm: ").strip()
    
    if confirm != confirm_msg:
        print("Cancelled - no changes made.")
        return
    
    # Update PIDs first (before any removals)
    updated_pid_count = 0
    if songs_to_update_pid:
        print(f"\n✨ Updating PIDs...")
        for song in songs_to_update_pid:
            day_key = song['day']
            if day_key in data:
                data[day_key]['PID'] = song['new_PID']
                updated_pid_count += 1
        print(f"✅ Updated {updated_pid_count} PIDs")
    
    # Remove the songs
    removed_count = 0
    if songs_to_remove:
        print(f"\n🗑️  Removing songs...")
        for song in songs_to_remove:
            if song['day'] in data:
                del data[song['day']]
                removed_count += 1
    
    # Renumber the remaining days only if songs were removed
    if removed_count > 0:
        print(f"\n🔄 Renumbering days to remove gaps...")
        old_data = data.copy()
        data.clear()
        
        # Sort the remaining days by their current day number
        sorted_days = sorted(old_data.items(), key=lambda x: int(x[0].replace('day', '')))
        
        # Renumber consecutively starting from day1
        for new_day_num, (old_day_key, day_content) in enumerate(sorted_days, 1):
            new_day_key = f"day{new_day_num}"
            data[new_day_key] = day_content
            # Update the title to match the new day number
            data[new_day_key]['title'] = f"Day {new_day_num}"
    
    # Save the cleaned calendar
    try:
        # Create backup first
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = FINAL_FILE.replace('.js', f'_before_clean_{timestamp}.js')
        import shutil
        shutil.copy2(FINAL_FILE, backup_file)
        print(f"📦 Backup saved: {backup_file}")
        
        # Save cleaned data
        save_data(FINAL_FILE, data, js_prefix, js_suffix)
        
        # Print summary
        if updated_pid_count > 0:
            print(f"✅ Updated {updated_pid_count} PIDs")
        if removed_count > 0:
            print(f"✅ Removed {removed_count} songs from calendar")
            print(f"✅ Renumbered remaining {len(data)} days consecutively")
            print(f"✅ Calendar now has days 1-{len(data)} with no gaps")
        
        # Save removed songs list if any were removed
        if removed_count > 0:
            removed_file = f"removed_songs_{timestamp}.json"
            with open(removed_file, 'w', encoding='utf-8') as f:
                json.dump(songs_to_remove, f, indent=2, ensure_ascii=False)
            print(f"📝 Saved list of removed songs to {removed_file}")
        
    except Exception as e:
        print(f"❌ Error saving cleaned calendar: {e}")
    
    input("\nPress Enter to continue...")


# ══════════════════════════════════════════════════════════════════════════════
# PART 2: PIN & RANDOMIZE FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

SONG_FIELDS = ["src", "song_embed", "PID", "metadata"]


def load_data(file_path):
    """Load calendar_data.js file"""
    with open(file_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if file_path.lower().endswith(".js"):
        start = raw.index("{")
        end   = raw.rindex("}") + 1
        return json.loads(raw[start:end]), raw[:start], raw[end:]
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f), None, None


def save_data(file_path, data, js_prefix=None, js_suffix=None):
    """Save calendar data back to JS file"""
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write((js_prefix or "") + json_str + (js_suffix or ""))


def load_pins():
    """Load pins from JSON file"""
    if os.path.isfile(PINS_FILE):
        with open(PINS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_pins(pins):
    """Save pins to JSON file"""
    with open(PINS_FILE, "w", encoding="utf-8") as f:
        json.dump(pins, f, indent=2)


def date_to_day_num(s):
    """Convert date string to day number"""
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
    """Generate human-readable day label"""
    d = START_DATE + timedelta(days=day_num - 1)
    return f"Day {day_num} ({d.strftime('%B %d, %Y')})"


def parse_target(raw, total_days):
    """Parse day number or date input"""
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


def song_payload(entry):
    """Extract just the song data fields from a day entry"""
    return {f: entry.get(f) for f in SONG_FIELDS}


def song_summary(entry):
    """Get readable song summary"""
    m = entry.get("metadata", {})
    return f"'{m.get('original_name', '?')}' by {m.get('original_artist', '?')}"


def pid_of(entry):
    """Get PID from entry"""
    return entry.get("PID")


def build_pid_index(data):
    """Returns { PID: day_key } for every entry in data"""
    return {entry.get("PID"): k for k, entry in data.items() if entry.get("PID")}


def find_song(data, query):
    """Case-insensitive partial name match"""
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


def apply_pins_and_randomize(data, pins):
    """Apply pins and randomize unpinned songs"""
    total    = len(data)
    all_keys = [f"day{i}" for i in range(1, total + 1)]

    pid_to_payload = {}
    for k in all_keys:
        entry = data[k]
        pid   = pid_of(entry)
        if pid:
            pid_to_payload[pid] = song_payload(entry)

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

    unpinned = [p for pid, p in pid_to_payload.items() if pid not in pinned_pids]
    random.shuffle(unpinned)
    unpinned_iter = iter(unpinned)

    new_data = copy.deepcopy(data)
    for i in range(1, total + 1):
        dest_key = f"day{i}"
        payload  = pinned_day_payloads.get(i) or next(unpinned_iter)
        for f in SONG_FIELDS:
            new_data[dest_key][f] = payload[f]

    return new_data


def show_pins(pins, data):
    """Display current pins"""
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
    """Add or update a pin"""
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
    """Remove a pin"""
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


def pin_and_randomize_menu():
    """Main menu for PART 2: Pin & Randomize"""
    print("\n" + "="*80)
    print("🎵 PART 2: Pin & Randomize Songs")
    print("="*80)
    print(f"  Calendar start: {START_DATE.strftime('%B %d, %Y')}  (= Day 1)\n")

    if not os.path.isfile(FINAL_FILE):
        print(f"❌  File not found: {FINAL_FILE}")
        print("    Please run Part 1 first to build the calendar.")
        return

    data, js_prefix, js_suffix = load_data(FINAL_FILE)
    pins = load_pins()
    print(f"✅  Loaded {len(data)} songs.  📌 {len(pins)} pin(s) active.\n")

    while True:
        print("─" * 40)
        print("  [1]  Add / update a pin")
        print("  [2]  Remove a pin")
        print("  [3]  View all pins")
        print("  [4]  Apply pins + randomize unpinned  →  save to calendar_data.js")
        print("  [5]  Exit")
        print()
        choice = input("  Choice: ").strip()

        if choice == "1":
            add_pin(data, pins)
            save_pins(pins)

        elif choice == "2":
            remove_pin(pins, data)
            save_pins(pins)

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
            save_data(FINAL_FILE, new_data, js_prefix, js_suffix)
            print(f"  ✅  Saved to: {FINAL_FILE}")
            data, js_prefix, js_suffix = load_data(FINAL_FILE)

        elif choice == "5":
            print("  Bye!")
            break

        else:
            print("  Please enter 1–5.")
        print()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print("\n" + "="*80)
    print("     🎵  Comprehensive Song Calendar Manager  🎵")
    print("="*80 + "\n")
    
    # Check if calendar already exists
    if os.path.exists(FINAL_FILE):
        try:
            data, _, _ = load_data(FINAL_FILE)
            num_days = len(data)
            print(f"✅ Found existing calendar: {FINAL_FILE}")
            print(f"   Current progress: {num_days}/{EXPECTED_DAYS} days\n")
            
            if num_days < EXPECTED_DAYS:
                print("What would you like to do?")
                print(f"  [1]  Continue building (add days {num_days + 1}-{EXPECTED_DAYS})")
                print("  [2]  Rebuild from scratch (WARNING: will lose current progress)")
                print("  [3]  See remaining songs")
                print("  [4]  Clean calendar (remove songs not in playlist)")
                print("  [5]  Pin & Randomize")
                print("  [6]  Continue building + Pin & Randomize")
                print()
                choice = input("Choice (1-6): ").strip()
                
                if choice == "1":
                    success = build_calendar()
                    if success:
                        print("\n✅ Calendar build complete!")
                elif choice == "2":
                    confirm = input("\n⚠️  Really rebuild from scratch? Current progress will be lost! (yes/no): ").strip().lower()
                    if confirm == "yes":
                        # Clear the checkpoint to force rebuild
                        if os.path.exists(CHECKPOINT_FILE):
                            os.remove(CHECKPOINT_FILE)
                        success = build_calendar()
                        if success:
                            print("\n✅ Calendar build complete!")
                    else:
                        print("Cancelled.")
                        return
                elif choice == "3":
                    show_remaining_songs()
                    return
                elif choice == "4":
                    clean_calendar_from_playlist()
                    return
                elif choice == "5":
                    pin_and_randomize_menu()
                    return
                elif choice == "6":
                    success = build_calendar()
                    if success:
                        pin_and_randomize_menu()
                    return
                else:
                    print("Invalid choice. Exiting.")
                    sys.exit(1)
            else:
                print("Calendar is complete! What would you like to do?")
                print("  [1]  Rebuild from scratch (WARNING: will lose current calendar)")
                print("  [2]  See remaining songs")
                print("  [3]  Clean calendar (remove songs not in playlist)")
                print("  [4]  Pin & Randomize existing calendar")
                print()
                choice = input("Choice (1-4): ").strip()
                
                if choice == "1":
                    confirm = input("\n⚠️  Really rebuild? Current calendar will be lost! (yes/no): ").strip().lower()
                    if confirm == "yes":
                        if os.path.exists(CHECKPOINT_FILE):
                            os.remove(CHECKPOINT_FILE)
                        success = build_calendar()
                        if success:
                            print("\n✅ Calendar build complete!")
                            cont = input("\nContinue to Pin & Randomize? (y/n): ").strip().lower()
                            if cont == "y":
                                pin_and_randomize_menu()
                    else:
                        print("Cancelled.")
                    return
                elif choice == "2":
                    show_remaining_songs()
                    return
                elif choice == "3":
                    clean_calendar_from_playlist()
                    return
                elif choice == "4":
                    pin_and_randomize_menu()
                    return
                else:
                    print("Invalid choice. Exiting.")
                    sys.exit(1)
            
            # After building, ask about pin & randomize
            cont = input("\nContinue to Pin & Randomize? (y/n): ").strip().lower()
            if cont == "y":
                pin_and_randomize_menu()
                
        except Exception as e:
            print(f"⚠️  Error reading calendar file: {e}")
            print("Starting from Part 1...\n")
            success = build_calendar()
            if success:
                print("\n✅ Calendar build complete!")
                cont = input("\nContinue to Pin & Randomize? (y/n): ").strip().lower()
                if cont == "y":
                    pin_and_randomize_menu()
    else:
        print("No existing calendar found. Starting from Part 1...\n")
        success = build_calendar()
        if success:
            print("\n✅ Calendar build complete!")
            cont = input("\nContinue to Pin & Randomize? (y/n): ").strip().lower()
            if cont == "y":
                pin_and_randomize_menu()


if __name__ == "__main__":
    main()
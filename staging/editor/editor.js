// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
const START_DATE   = new Date(2026, 1, 14);   // Feb 14 2026
const PLAYLIST_PID = 'BBE2197D42966E62';

// Fields that travel with the song when dragged or shuffled
const SONG_FIELDS = ['src', 'song_embed', 'PID', 'metadata', 'message', 'pinned'];

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let calData      = {};     // working copy of loveData
let dragSrc      = null;   // card element being dragged
let hasUnsaved   = false;
let fileHandle   = null;   // File System Access API handle for calendar_data.js
let xmlFile      = null;   // selected library XML: { type: 'handle'|'classic', handle|file }
let fetchResults = null;   // pending { pidUpdates, newSongs, missing } from analysis

// ══════════════════════════════════════════════
// INIT
// ensures every entry has pinned: boolean
// ══════════════════════════════════════════════
function init() {
    calData = JSON.parse(JSON.stringify(loveData));
    Object.keys(calData).forEach(dk => {
        if (typeof calData[dk].pinned !== 'boolean') calData[dk].pinned = false;
    });
    renderGrid();
    updateLinkedFileUI();
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function dayToDate(n) {
    const d = new Date(START_DATE);
    d.setDate(d.getDate() + n - 1);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normMatch(s) {
    return (s || '').toLowerCase().trim();
}

// ══════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════
function renderGrid() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    Object.keys(calData)
        .sort((a, b) => parseInt(a.replace('day', '')) - parseInt(b.replace('day', '')))
        .forEach(dk => {
            const n      = parseInt(dk.replace('day', ''));
            const e      = calData[dk];
            const pinned = !!e.pinned;
            const hasMsg = (e.message || '').trim().length > 0;
            const name   = e.metadata?.original_name   || '(Unknown)';
            const artist = e.metadata?.original_artist || '';

            const card = document.createElement('div');
            card.className = `song-card${pinned ? ' pinned' : ''}${hasMsg ? ' has-message' : ''}`;
            card.dataset.day = dk;

            card.innerHTML = `
                <div class="card-top">
                    <div class="day-badge">Day ${n} · ${dayToDate(n)}</div>
                    <div class="card-actions">
                        <button class="icon-btn pin-btn${pinned ? ' active' : ''}"
                                title="${pinned ? 'Unpin' : 'Pin'}"
                                onclick="togglePin(event, '${dk}')">
                            ${pinned ? '📌' : '📍'}
                        </button>
                        <button class="icon-btn" title="Preview" onclick="openPreview(event, '${dk}')">▶</button>
                    </div>
                </div>
                <div class="song-name" title="${esc(name)}">${esc(name)}</div>
                <div class="song-artist">${esc(artist)}</div>
                <div class="pid-badge">${e.PID || ''}</div>
                <div class="message-wrap${hasMsg ? ' has-message' : ''}">
                    <div class="message-label">
                        <div class="msg-dot"></div>
                        Message
                    </div>
                    <textarea class="msg-input"
                        placeholder="Write a personal message for this day…"
                        data-day="${dk}"
                        oninput="onMsgInput(this)">${esc(e.message || '')}</textarea>
                </div>`;

            attachDragListeners(card);
            grid.appendChild(card);
        });

    updateStats();
}

// ══════════════════════════════════════════════
// DRAG & DROP — pointer-event based so scrolling
// works while holding a card
// ══════════════════════════════════════════════

// Ghost element that follows the cursor
let ghost        = null;
let ghostOffsetX = 0;
let ghostOffsetY = 0;
let currentOver  = null;   // card currently under the ghost
let scrollRAF    = null;   // requestAnimationFrame id for auto-scroll

const SCROLL_ZONE  = 80;   // px from viewport edge that triggers auto-scroll
const SCROLL_SPEED = 12;   // px per frame

function attachDragListeners(card) {
    card.addEventListener('pointerdown', onPointerDown);
}

function onPointerDown(e) {
    // Only trigger on left click, ignore buttons/textareas
    if (e.button !== 0) return;
    if (e.target.closest('button, textarea')) return;

    const card = e.currentTarget;
    if (card.classList.contains('pinned')) return;

    e.preventDefault();   // stop text selection

    dragSrc = card;

    // Measure card for ghost sizing
    const rect = card.getBoundingClientRect();
    ghostOffsetX = e.clientX - rect.left;
    ghostOffsetY = e.clientY - rect.top;

    // Build ghost: a visual clone that floats under the cursor
    ghost = card.cloneNode(true);
    ghost.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        pointer-events: none;
        opacity: 0.75;
        transform: scale(1.04) rotate(1.5deg);
        box-shadow: 0 20px 50px rgba(74,14,14,0.25);
        z-index: 8000;
        transition: none;
    `;
    document.body.appendChild(ghost);

    card.classList.add('dragging');

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup',   onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
    if (!ghost || !dragSrc) return;

    // Move ghost
    ghost.style.left = `${e.clientX - ghostOffsetX}px`;
    ghost.style.top  = `${e.clientY - ghostOffsetY}px`;

    // Hit-test: find which card is under the cursor (ignoring the ghost)
    ghost.style.display = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.song-card');
    ghost.style.display = '';

    if (currentOver && currentOver !== target) {
        currentOver.classList.remove('drag-over');
    }
    if (target && target !== dragSrc) {
        target.classList.add('drag-over');
        currentOver = target;
    } else {
        currentOver = null;
    }

    // Auto-scroll when near viewport edges
    cancelAnimationFrame(scrollRAF);
    const vy = e.clientY;
    const vh = window.innerHeight;

    if (vy < SCROLL_ZONE || vy > vh - SCROLL_ZONE) {
        const dir = vy < SCROLL_ZONE ? -1 : 1;
        const dist = vy < SCROLL_ZONE
            ? (SCROLL_ZONE - vy) / SCROLL_ZONE
            : (vy - (vh - SCROLL_ZONE)) / SCROLL_ZONE;
        const speed = Math.round(SCROLL_SPEED * dist);

        function doScroll() {
            window.scrollBy(0, dir * speed);
            scrollRAF = requestAnimationFrame(doScroll);
        }
        scrollRAF = requestAnimationFrame(doScroll);
    }
}

function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup',   onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);

    cancelAnimationFrame(scrollRAF);
    scrollRAF = null;

    // Clean up ghost
    if (ghost) { ghost.remove(); ghost = null; }

    if (!dragSrc) return;
    dragSrc.classList.remove('dragging');

    if (currentOver) {
        currentOver.classList.remove('drag-over');

        const src = dragSrc.dataset.day;
        const tgt = currentOver.dataset.day;

        if (calData[tgt].pinned) {
            showToast('📌 That day is pinned — unpin it first');
        } else {
            SONG_FIELDS.forEach(f => {
                [calData[src][f], calData[tgt][f]] = [calData[tgt][f], calData[src][f]];
            });
            markUnsaved();
            renderGrid();
            showToast(`🔀 Swapped Day ${src.replace('day', '')} ↔ Day ${tgt.replace('day', '')}`);
        }
    }

    dragSrc     = null;
    currentOver = null;
}

// ══════════════════════════════════════════════
// PINS — stored as calData[dk].pinned boolean
// ══════════════════════════════════════════════
function togglePin(e, dk) {
    e.stopPropagation();
    calData[dk].pinned = !calData[dk].pinned;
    markUnsaved();
    renderGrid();
    showToast(calData[dk].pinned ? '📌 Pinned' : '📍 Unpinned');
}

function clearAllPins() {
    const count = Object.values(calData).filter(e => e.pinned).length;
    if (!count) { showToast('No pins to clear'); return; }
    Object.keys(calData).forEach(dk => calData[dk].pinned = false);
    markUnsaved();
    renderGrid();
    showToast(`📍 Cleared ${count} pins`);
}

// ══════════════════════════════════════════════
// RANDOMIZE UNPINNED
// ══════════════════════════════════════════════
function randomizeUnpinned() {
    const keys = Object.keys(calData)
        .sort((a, b) => parseInt(a.replace('day', '')) - parseInt(b.replace('day', '')))
        .filter(dk => !calData[dk].pinned);

    if (keys.length < 2) { showToast('Not enough unpinned songs to shuffle'); return; }

    // Snapshot song data from unpinned slots
    const songs = keys.map(dk => {
        const o = {};
        SONG_FIELDS.forEach(f => o[f] = calData[dk][f]);
        return o;
    });

    // Fisher-Yates shuffle
    for (let i = songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songs[i], songs[j]] = [songs[j], songs[i]];
    }

    // Write back, keeping pinned: false on all shuffled slots
    keys.forEach((dk, i) => {
        SONG_FIELDS.forEach(f => calData[dk][f] = songs[i][f]);
        calData[dk].pinned = false;
    });

    markUnsaved();
    renderGrid();
    showToast(`🔀 Shuffled ${keys.length} unpinned songs`);

    document.querySelectorAll('.song-card:not(.pinned)').forEach(c => {
        c.classList.add('shuffled');
        setTimeout(() => c.classList.remove('shuffled'), 550);
    });
}

// ══════════════════════════════════════════════
// MESSAGES
// ══════════════════════════════════════════════
function onMsgInput(ta) {
    calData[ta.dataset.day].message = ta.value;
    ta.closest('.song-card').classList.toggle('has-message', ta.value.trim().length > 0);
    markUnsaved();
    updateStats();
}

// ══════════════════════════════════════════════
// PREVIEW MODAL
// ══════════════════════════════════════════════
function openPreview(e, dk) {
    e.stopPropagation();
    const n     = parseInt(dk.replace('day', ''));
    const entry = calData[dk];
    document.getElementById('prvDay').textContent  = `Day ${n} · ${entry.metadata?.original_name || ''}`;
    document.getElementById('prvDate').textContent = dayToDate(n);
    document.getElementById('prvPlayer').innerHTML = entry.song_embed || '';
    const msgEl = document.getElementById('prvMsg');
    if ((entry.message || '').trim()) {
        msgEl.textContent  = entry.message;
        msgEl.style.display = 'block';
    } else {
        msgEl.style.display = 'none';
    }
    document.getElementById('previewModal').classList.add('active');
}

function openPreviewToday() {
    const diff = Math.floor((Date.now() - START_DATE) / 86400000) + 1;
    openPreview({ stopPropagation: () => {} }, `day${Math.max(1, Math.min(diff, 365))}`);
}

function closePreview() {
    document.getElementById('previewModal').classList.remove('active');
    document.getElementById('prvPlayer').innerHTML = '';
}

// ══════════════════════════════════════════════
// SEARCH / FILTER
// ══════════════════════════════════════════════
function filterCards() {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    document.querySelectorAll('.song-card').forEach(card => {
        const e  = calData[card.dataset.day] || {};
        const n  = (e.metadata?.original_name   || '').toLowerCase();
        const a  = (e.metadata?.original_artist || '').toLowerCase();
        const m  = (e.message || '').toLowerCase();
        const d  = card.dataset.day.replace('day', '');
        const ok = !q || n.includes(q) || a.includes(q) || m.includes(q) || d.includes(q);
        card.classList.toggle('hidden', !ok);
    });
}

// ══════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════
function updateStats() {
    const all    = Object.keys(calData);
    const pinned = all.filter(dk => calData[dk].pinned).length;
    const msgs   = all.filter(dk => (calData[dk].message || '').trim()).length;
    document.getElementById('sDays').textContent     = all.length;
    document.getElementById('sPinned').textContent   = pinned;
    document.getElementById('sMsg').textContent      = msgs;
    document.getElementById('sUnpinned').textContent = all.length - pinned;
    document.getElementById('toolbarInfo').textContent = `${all.length} / 365 days built`;
}

// ══════════════════════════════════════════════
// UNSAVED STATE
// ══════════════════════════════════════════════
function markUnsaved() {
    hasUnsaved = true;
    document.getElementById('saveBanner').classList.add('visible');
}

function discardChanges() {
    calData = JSON.parse(JSON.stringify(loveData));
    Object.keys(calData).forEach(dk => {
        if (typeof calData[dk].pinned !== 'boolean') calData[dk].pinned = false;
    });
    hasUnsaved = false;
    document.getElementById('saveBanner').classList.remove('visible');
    renderGrid();
    showToast('Changes discarded');
}

// ══════════════════════════════════════════════
// SAVE — File System Access API (true overwrite)
// Falls back to download on Safari / Firefox
// ══════════════════════════════════════════════
function buildJS() {
    return `const loveData = ${JSON.stringify(calData, null, 4)};\n`;
}

// Ask the user to pick the actual calendar_data.js on disk so we can
// overwrite it in place on every subsequent save (no "save as" dialog).
async function linkFile() {
    if (!window.showOpenFilePicker) {
        showToast('⚠️ File linking not supported in this browser — use Save (downloads a copy)');
        return;
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'JavaScript', accept: { 'text/javascript': ['.js'] } }],
            multiple: false
        });
        // Verify write permission up front
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            showToast('❌ Write permission denied');
            return;
        }
        fileHandle = handle;
        updateLinkedFileUI();
        showToast(`🔗 Linked to ${handle.name} — Cmd+S will overwrite it directly`);
    } catch (err) {
        if (err.name !== 'AbortError') showToast('Could not link file');
    }
}

function updateLinkedFileUI() {
    const btn = document.getElementById('linkFileBtn');
    if (!btn) return;
    if (fileHandle) {
        btn.textContent = `🔗 ${fileHandle.name}`;
        btn.title = 'Click to relink a different file';
        btn.classList.add('linked');
    } else {
        btn.textContent = '🔗 Link File';
        btn.title = 'Link calendar_data.js so saves overwrite it directly';
        btn.classList.remove('linked');
    }
}

async function saveFile() {
    const content = buildJS();

    // If we have a handle (linked file), write straight to it — no dialog
    if (fileHandle) {
        try {
            // Re-check permission in case it lapsed
            const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') throw new Error('permission denied');

            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            hasUnsaved = false;
            document.getElementById('saveBanner').classList.remove('visible');
            showToast(`✅ Saved to ${fileHandle.name}`);
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            // Handle went stale — clear it and fall through to download
            fileHandle = null;
            updateLinkedFileUI();
            showToast('⚠️ File link lost — re-link or downloading a copy');
        }
    }

    // No linked file — prompt to link first if the API is available
    if (window.showOpenFilePicker) {
        showToast('💡 Tip: click "🔗 Link File" to enable direct overwrite saves');
    }

    // Fallback: download a copy
    const blob = new Blob([content], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'calendar_data.js'; a.click();
    URL.revokeObjectURL(url);
    hasUnsaved = false;
    document.getElementById('saveBanner').classList.remove('visible');
    showToast('⬇ Downloaded a copy — link the file for direct overwrite');
}

// ══════════════════════════════════════════════
// FETCH SONGS MODAL
// ══════════════════════════════════════════════
function openFetchModal() {
    fetchResults = null;
    document.getElementById('fetchLog').style.display       = 'none';
    document.getElementById('fetchLog').innerHTML           = '';
    document.getElementById('fetchProgress').style.display  = 'none';
    document.getElementById('fetchApplyBtn').style.display  = 'none';
    document.getElementById('fetchRunBtn').disabled         = (xmlFile === null);
    document.getElementById('fetchModal').classList.add('active');
}

function closeFetchModal() {
    document.getElementById('fetchModal').classList.remove('active');
}

async function pickXMLFile() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'iTunes XML', accept: { 'text/xml': ['.xml'] } }]
            });
            xmlFile = { type: 'handle', handle };
            document.getElementById('fetchFileName').textContent = handle.name;
            document.getElementById('fetchRunBtn').disabled = false;
        } catch (e) {
            if (e.name !== 'AbortError') showToast('Could not open file');
        }
    } else {
        // Fallback for Safari / Firefox
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.xml';
        input.onchange = () => {
            if (input.files[0]) {
                xmlFile = { type: 'classic', file: input.files[0] };
                document.getElementById('fetchFileName').textContent = input.files[0].name;
                document.getElementById('fetchRunBtn').disabled = false;
            }
        };
        input.click();
    }
}

// ── Core fetch & analysis ────────────────────
async function runFetch() {
    const logEl  = document.getElementById('fetchLog');
    const fillEl = document.getElementById('fetchFill');
    const progEl = document.getElementById('fetchProgress');

    logEl.innerHTML = '';
    logEl.style.display  = 'block';
    progEl.style.display = 'block';
    fillEl.style.width   = '0%';
    document.getElementById('fetchRunBtn').disabled = true;
    document.getElementById('fetchApplyBtn').style.display = 'none';
    fetchResults = null;

    function log(msg, cls = '') {
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = msg;
        logEl.appendChild(span);
        logEl.appendChild(document.createTextNode('\n'));
        logEl.scrollTop = logEl.scrollHeight;
    }

    try {
        // 1. Read XML text from selected file
        let xmlText;
        if (xmlFile.type === 'handle') {
            const f = await xmlFile.handle.getFile();
            xmlText = await f.text();
        } else {
            xmlText = await xmlFile.file.text();
        }
        fillEl.style.width = '12%';
        log(`✅ Loaded XML (${(xmlText.length / 1024).toFixed(0)} KB)`, 'log-ok');

        // 2. Parse Apple plist XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        function parsePlistValue(node) {
            if (!node) return null;
            switch (node.tagName) {
                case 'string':  return node.textContent;
                case 'integer': return parseInt(node.textContent, 10);
                case 'real':    return parseFloat(node.textContent);
                case 'true':    return true;
                case 'false':   return false;
                case 'dict': {
                    const obj = {}, kids = [...node.children];
                    for (let i = 0; i < kids.length; i += 2) {
                        const k = kids[i]?.textContent;
                        if (k) obj[k] = parsePlistValue(kids[i + 1]);
                    }
                    return obj;
                }
                case 'array': return [...node.children].map(parsePlistValue);
                default:      return node.textContent;
            }
        }

        const root = parsePlistValue(xmlDoc.querySelector('plist > dict'));
        if (!root) throw new Error('Could not parse plist root dict');
        fillEl.style.width = '28%';
        log('✅ Parsed plist structure', 'log-ok');

        // 3. Tracks lookup
        const tracks = root['Tracks'] || {};

        // 4. Find target playlist by Persistent ID
        const playlists = root['Playlists'] || [];
        let targetPL = null;
        for (const pl of playlists) {
            if (pl['Playlist Persistent ID'] === PLAYLIST_PID) { targetPL = pl; break; }
        }

        if (!targetPL) {
            log(`❌ Playlist PID ${PLAYLIST_PID} not found`, 'log-err');
            log('Available playlists:', 'log-warn');
            playlists.forEach(pl => log(`  • "${pl['Name']}" — ${pl['Playlist Persistent ID']}`, 'log-warn'));
            return;
        }

        const plItems = targetPL['Playlist Items'] || [];
        log(`✅ Found playlist "${targetPL['Name']}" (${plItems.length} items)`, 'log-ok');
        fillEl.style.width = '44%';

        // 5. Build deduped playlist song list
        const playlistSongs = [];
        const seenPIDs = new Set();
        for (const item of plItems) {
            const info = tracks[String(item['Track ID'])];
            if (!info) continue;
            const pid = info['Persistent ID'];
            if (!pid || seenPIDs.has(pid)) {
                if (seenPIDs.has(pid)) log(`⚠️  Duplicate: ${info['Name']} — skipped`, 'log-warn');
                continue;
            }
            seenPIDs.add(pid);
            playlistSongs.push({
                name:   info['Name']   || 'Unknown',
                artist: info['Artist'] || 'Unknown',
                album:  info['Album']  || '',
                PID:    pid
            });
        }
        log(`✅ ${playlistSongs.length} unique songs in playlist`, 'log-ok');
        fillEl.style.width = '60%';

        // 6. Build name+artist → song lookup (same logic as Python normalize_for_match)
        const plByKey = {};
        for (const s of playlistSongs) {
            plByKey[normMatch(s.name) + '|||' + normMatch(s.artist)] = s;
        }

        // 7. Compare calendar to playlist
        const pidUpdates = [];
        const missing    = [];
        const calKeys    = Object.keys(calData).map(dk =>
            normMatch(calData[dk].metadata?.original_name) + '|||' +
            normMatch(calData[dk].metadata?.original_artist)
        );

        for (const dk of Object.keys(calData)) {
            const e     = calData[dk];
            const key   = normMatch(e.metadata?.original_name) + '|||' + normMatch(e.metadata?.original_artist);
            const match = plByKey[key];

            if (!match) {
                missing.push({ dk, name: e.metadata?.original_name, artist: e.metadata?.original_artist });
            } else if (match.PID !== e.PID) {
                pidUpdates.push({ dk, oldPID: e.PID, newPID: match.PID, name: e.metadata?.original_name, artist: e.metadata?.original_artist });
            }
        }

        // 8. New songs in playlist not yet in calendar
        const newSongs = playlistSongs.filter(s =>
            !calKeys.includes(normMatch(s.name) + '|||' + normMatch(s.artist))
        );
        fillEl.style.width = '85%';

        // 9. Report results
        log('', '');
        log('─────────────────────────────────────────────', '');

        if (!pidUpdates.length && !missing.length && !newSongs.length) {
            log('✅ Everything is up to date — no changes needed!', 'log-ok');
        } else {
            if (pidUpdates.length) {
                log(`✨ ${pidUpdates.length} songs with updated PIDs:`, 'log-warn');
                pidUpdates.forEach(u => log(`  Day ${u.dk.replace('day', '')} · "${u.name}"  ${u.oldPID} → ${u.newPID}`, 'log-warn'));
            }
            if (newSongs.length) {
                log('', '');
                log(`🆕 ${newSongs.length} new songs in playlist (not in calendar yet):`, 'log-new');
                newSongs.forEach(s => log(`  • "${s.name}" — ${s.artist}  (PID: ${s.PID})`, 'log-new'));
            }
            if (missing.length) {
                log('', '');
                log(`⚠️  ${missing.length} calendar songs NOT found in playlist:`, 'log-err');
                missing.forEach(m => log(`  Day ${m.dk.replace('day', '')} · "${m.name}" — ${m.artist}`, 'log-err'));
            }
        }

        fillEl.style.width = '100%';
        fetchResults = { pidUpdates, newSongs, missing };
        if (pidUpdates.length || newSongs.length) {
            document.getElementById('fetchApplyBtn').style.display = 'block';
        }

    } catch (err) {
        log(`❌ Error: ${err.message}`, 'log-err');
        console.error(err);
    } finally {
        document.getElementById('fetchRunBtn').disabled = false;
    }
}

// ── Apply fetch results ──────────────────────
function applyFetchResults() {
    if (!fetchResults) return;
    const { pidUpdates, newSongs } = fetchResults;
    let changes = 0;

    // Fix stale PIDs in existing entries
    pidUpdates.forEach(u => { calData[u.dk].PID = u.newPID; changes++; });

    // Add new songs as placeholder entries (embeds built later by swap.py)
    if (newSongs.length) {
        const maxDay = Math.max(...Object.keys(calData).map(dk => parseInt(dk.replace('day', ''))));
        newSongs.forEach((s, i) => {
            const n = maxDay + 1 + i;
            calData[`day${n}`] = {
                title:      `Day ${n}`,
                message:    '',
                src:        '',
                song_embed: '',
                PID:        s.PID,
                pinned:     false,
                metadata: {
                    original_name:   s.name,
                    original_artist: s.artist,
                    matched_name:    '',
                    matched_artist:  '',
                    match_quality:   'Pending — run swap.py to build embed'
                }
            };
            changes++;
        });
    }

    if (changes) {
        markUnsaved();
        renderGrid();
        showToast(`✅ Applied ${changes} change${changes !== 1 ? 's' : ''} — save to commit`);
    }
    closeFetchModal();
}

// ══════════════════════════════════════════════
// FILL METADATA
// Replicates json_creator.py logic:
//   - iTunesSearch API (no CORS issues, public)
//   - Same scoring: name exact=10, partial=5;
//     artist exact=5, partial=2; album =3/1
//   - Builds src + song_embed for every card
//     where src is empty / Pending
//   - Rate-limited: 3–6.5 s between calls,
//     60 s break every 25 calls
// ══════════════════════════════════════════════

let metaRunning   = false;
let metaAbort     = false;
let metaQueue     = [];   // [ { dk, name, artist, album } ]

// ── slug normalizer (same as Python normalize()) ──
function slugify(text) {
    if (!text) return '';
    // Basic NFD-like decomposition isn't available natively,
    // but we can strip common accented chars with a map then clean up
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// ── embed builders ────────────────────────────
function buildSrc(name, trackId) {
    return `https://embed.music.apple.com/us/song/${slugify(name)}/${trackId}`;
}

function buildEmbed(name, trackId) {
    const src = buildSrc(name, trackId);
    return `<iframe allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="175" style="width:100%;max-width:660px;overflow:hidden;border-radius:10px;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" src="${src}"></iframe>`;
}

// ── iTunes Search API call ────────────────────
async function searchiTunes(name, artist, album, retries = 0) {
    const query = encodeURIComponent(`${name} ${artist}`);
    const url   = `https://itunes.apple.com/search?term=${query}&entity=song&limit=10`;

    let resp;
    try {
        resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (err) {
        if (retries < 3) {
            await sleep(5000);
            return searchiTunes(name, artist, album, retries + 1);
        }
        return { error: 'timeout' };
    }

    if (resp.status === 429 || resp.status === 403) {
        if (retries >= 5) return { error: 'rate_limit_exceeded' };
        const wait = Math.min(300000, Math.pow(2, retries) * 30000);
        metaLog(`   ⏳ Rate limited — waiting ${wait/1000}s…`, 'log-warn');
        await sleep(wait);
        return searchiTunes(name, artist, album, retries + 1);
    }

    if (resp.status !== 200) return { error: `http_${resp.status}` };

    const data = await resp.json();
    if (!data.resultCount) return { error: 'no_results' };

    const normName   = name.toLowerCase().trim();
    const normArtist = artist.toLowerCase().trim();
    const normAlbum  = (album || '').toLowerCase().trim();

    let best = null, bestScore = 0;

    for (const r of data.results) {
        const rName   = (r.trackName      || '').toLowerCase().trim();
        const rArtist = (r.artistName     || '').toLowerCase().trim();
        const rAlbum  = (r.collectionName || '').toLowerCase().trim();

        let score = 0;
        if (rName   === normName)                          score += 10;
        else if (normName.includes(rName) || rName.includes(normName)) score += 5;

        if (rArtist === normArtist)                            score += 5;
        else if (normArtist.includes(rArtist) || rArtist.includes(normArtist)) score += 2;

        if (normAlbum && rAlbum === normAlbum)                 score += 3;
        else if (normAlbum && (normAlbum.includes(rAlbum) || rAlbum.includes(normAlbum))) score += 1;

        if (score > bestScore) { bestScore = score; best = r; }
    }

    if (!best) best = data.results[0];

    const quality = bestScore >= 15 ? 'High Confidence'
                  : bestScore >= 8  ? 'Medium Confidence'
                  : bestScore > 0   ? 'Low Confidence'
                  : 'Fallback';

    return {
        id:             best.trackId,
        official_name:  best.trackName,
        official_artist:best.artistName,
        official_album: best.collectionName,
        match_quality:  quality,
        match_score:    bestScore
    };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Modal helpers ─────────────────────────────
function metaLog(msg, cls = '') {
    const logEl = document.getElementById('metaLog');
    if (!logEl) return;
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg;
    logEl.appendChild(span);
    logEl.appendChild(document.createTextNode('\n'));
    logEl.scrollTop = logEl.scrollHeight;
}

function metaSetProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fillEl = document.getElementById('metaFill');
    if (fillEl) fillEl.style.width = `${pct}%`;
    const labelEl = document.getElementById('metaProgressLabel');
    if (labelEl) labelEl.textContent = `${done} / ${total}`;
}

// ── Open modal ────────────────────────────────
function openMetaModal() {
    // Build queue: cards with empty src or match_quality 'Pending'
    metaQueue = Object.keys(calData)
        .sort((a, b) => parseInt(a.replace('day','')) - parseInt(b.replace('day','')))
        .filter(dk => {
            const e = calData[dk];
            return !e.src || e.src.trim() === '' ||
                   (e.metadata?.match_quality || '').startsWith('Pending');
        })
        .map(dk => ({
            dk,
            name:   calData[dk].metadata?.original_name   || '',
            artist: calData[dk].metadata?.original_artist || '',
            album:  calData[dk].metadata?.original_album  || ''
        }));

    const logEl = document.getElementById('metaLog');
    if (logEl) { logEl.innerHTML = ''; logEl.style.display = 'none'; }

    const fillEl = document.getElementById('metaFill');
    if (fillEl) fillEl.style.width = '0%';
    const labelEl = document.getElementById('metaProgressLabel');
    if (labelEl) labelEl.textContent = '';

    document.getElementById('metaRunBtn').disabled    = metaQueue.length === 0;
    document.getElementById('metaAbortBtn').style.display = 'none';
    document.getElementById('metaRunBtn').style.display   = 'inline-flex';

    const countEl = document.getElementById('metaQueueCount');
    if (countEl) {
        countEl.textContent = metaQueue.length === 0
            ? '✅ All cards already have embed data.'
            : `${metaQueue.length} card${metaQueue.length !== 1 ? 's' : ''} need metadata.`;
    }

    document.getElementById('metaModal').classList.add('active');
}

function closeMetaModal() {
    metaAbort = true;   // signal any running loop to stop
    document.getElementById('metaModal').classList.remove('active');
}

// ── Run the fill loop ─────────────────────────
async function runMetaFill() {
    if (metaRunning || metaQueue.length === 0) return;
    metaRunning = true;
    metaAbort   = false;

    const logEl = document.getElementById('metaLog');
    logEl.innerHTML  = '';
    logEl.style.display = 'block';

    document.getElementById('metaRunBtn').style.display   = 'none';
    document.getElementById('metaAbortBtn').style.display = 'inline-flex';

    const total   = metaQueue.length;
    let done      = 0;
    let succeeded = 0;
    let failed    = 0;
    let apiCalls  = 0;

    metaLog(`🎵 Starting metadata fill for ${total} cards…`, 'log-ok');
    metaLog('', '');

    for (const item of metaQueue) {
        if (metaAbort) {
            metaLog('', '');
            metaLog('⛔ Aborted by user.', 'log-warn');
            break;
        }

        const n = parseInt(item.dk.replace('day', ''));
        metaLog(`Day ${n} · "${item.name}" — ${item.artist}`);

        // Long break every 25 API calls (same as Python)
        if (apiCalls > 0 && apiCalls % 25 === 0) {
            const breakMs = 60000;
            metaLog(`   ☕ ${apiCalls} calls done — pausing ${breakMs/1000}s…`, 'log-warn');
            for (let t = breakMs; t > 0 && !metaAbort; t -= 1000) {
                document.getElementById('metaAbortBtn').textContent = `⛔ Abort (resuming in ${t/1000}s)`;
                await sleep(1000);
            }
            document.getElementById('metaAbortBtn').textContent = '⛔ Abort';
            if (metaAbort) break;
        }

        const result = await searchiTunes(item.name, item.artist, item.album);
        apiCalls++;

        if (result.error || !result.id) {
            metaLog(`   ❌ Failed: ${result.error || 'no id'}`, 'log-err');
            failed++;
        } else {
            // Write into calData — metadata only, no embed (as requested)
            calData[item.dk].src        = buildSrc(item.name, result.id);
            calData[item.dk].song_embed = buildEmbed(item.name, result.id);
            calData[item.dk].metadata   = {
                original_name:   item.name,
                original_artist: item.artist,
                matched_name:    result.official_name,
                matched_artist:  result.official_artist,
                match_quality:   result.match_quality
            };

            const qual = result.match_quality;
            const cls  = qual === 'High Confidence' ? 'log-ok'
                       : qual === 'Medium Confidence' ? 'log-warn'
                       : 'log-err';
            metaLog(`   ✅ ID ${result.id} · ${qual} (score ${result.match_score})`, cls);
            succeeded++;
            markUnsaved();
        }

        done++;
        metaSetProgress(done, total);

        // Throttle: 3–6.5 s between calls (same as Python)
        if (done < total && !metaAbort) {
            const wait = 3000 + Math.random() * 3500;
            await sleep(wait);
        }
    }

    metaLog('', '');
    metaLog(`─────────────────────────────────────────────`, '');
    metaLog(`✅ Done: ${succeeded} succeeded, ❌ ${failed} failed, ${apiCalls} API calls`, succeeded > 0 ? 'log-ok' : 'log-warn');

    if (succeeded > 0) {
        renderGrid();
        showToast(`✅ Filled ${succeeded} card${succeeded !== 1 ? 's' : ''} — save when ready`);
    }

    document.getElementById('metaAbortBtn').style.display = 'none';
    document.getElementById('metaRunBtn').style.display   = 'inline-flex';
    document.getElementById('metaRunBtn').disabled = true;   // queue exhausted
    metaRunning = false;
}

function abortMeta() {
    metaAbort = true;
}
let toastTimer;
function showToast(msg, ms = 2600) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ══════════════════════════════════════════════
// KEYBOARD & EVENT WIRING
// ══════════════════════════════════════════════
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePreview(); closeFetchModal(); closeMetaModal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveFile(); }
});

window.addEventListener('beforeunload', e => {
    if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('previewModal').addEventListener('click', function (e) {
    if (e.target === this) closePreview();
});

document.getElementById('fetchModal').addEventListener('click', function (e) {
    if (e.target === this) closeFetchModal();
});

document.getElementById('metaModal').addEventListener('click', function (e) {
    if (e.target === this) closeMetaModal();
});

// ══════════════════════════════════════════════
// GITHUB COMMIT
// Uses the GitHub Contents API to read the current
// SHA, then PUT the new file content in one call.
// ══════════════════════════════════════════════

// Persist settings in memory only (cleared on page reload)
let ghSettings = { token: '', repo: '', branch: 'main', path: 'assets/calendar_data.js' };

// Count how many day-slots differ between calData and loveData
function countChangedSongs() {
    let diff = 0;
    const allKeys = new Set([...Object.keys(calData), ...Object.keys(loveData)]);
    allKeys.forEach(dk => {
        const cur = calData[dk];
        const orig = loveData[dk];
        if (!orig || !cur) { diff++; return; }
        // Compare the fields that matter for "a different song"
        const songChanged = ['src', 'PID', 'song_embed'].some(f => cur[f] !== orig[f]);
        const msgChanged  = (cur.message || '') !== (orig.message || '');
        if (songChanged || msgChanged) diff++;
    });
    return diff;
}

function buildCommitMessage() {
    const n = countChangedSongs();
    return `updated calendar_data.js with ${n} song${n !== 1 ? 's' : ''} different`;
}

async function openGithubModal() {
    // Restore last-used values
    document.getElementById('ghToken').value  = ghSettings.token;
    document.getElementById('ghRepo').value   = ghSettings.repo;
    document.getElementById('ghBranch').value = ghSettings.branch;
    document.getElementById('ghPath').value   = ghSettings.path;

    // Auto-load token from key.txt if we don't already have one
    if (!ghSettings.token) {
    try {
        const resp = await fetch('key.json');
        if (resp.ok) {
            const cfg = await resp.json();
            if (cfg.key) {
                ghSettings.token = cfg.key;
                document.getElementById('ghToken').value = cfg.key;
            }
            if (cfg.repo_path) {
                ghSettings.repo = cfg.repo_path;
                document.getElementById('ghRepo').value = cfg.repo_path;
            }
        }
    } catch (e) {
        // key.json not found or unreadable — user can enter manually
    }
}

    updateCommitMsgPreview();

    const logEl = document.getElementById('ghLog');
    logEl.innerHTML = '';
    logEl.style.display = 'none';
    document.getElementById('ghProgressBar').style.display = 'none';
    document.getElementById('ghFill').style.width = '0%';
    document.getElementById('ghCommitBtn').disabled = false;

    document.getElementById('githubModal').classList.add('active');
}

function closeGithubModal() {
    document.getElementById('githubModal').classList.remove('active');
}

function updateCommitMsgPreview() {
    const el = document.getElementById('ghCommitMsgPreview');
    if (el) el.textContent = '💬 ' + buildCommitMessage();
}

function ghLog(msg, cls = '') {
    const logEl = document.getElementById('ghLog');
    logEl.style.display = 'block';
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg;
    logEl.appendChild(span);
    logEl.appendChild(document.createTextNode('\n'));
    logEl.scrollTop = logEl.scrollHeight;
}

async function runGithubCommit() {
    const token  = document.getElementById('ghToken').value.trim();
    const repo   = document.getElementById('ghRepo').value.trim();
    const branch = document.getElementById('ghBranch').value.trim() || 'main';
    const path   = document.getElementById('ghPath').value.trim();

    if (!token)  { showToast('❌ Enter a GitHub token'); return; }
    if (!repo || !repo.includes('/')) { showToast('❌ Enter repo as owner/repo'); return; }
    if (!path)   { showToast('❌ Enter the file path'); return; }

    // Persist for re-use this session
    ghSettings = { token, repo, branch, path };

    const commitMsg = buildCommitMessage();

    const logEl  = document.getElementById('ghLog');
    const fillEl = document.getElementById('ghFill');
    const progEl = document.getElementById('ghProgressBar');

    logEl.innerHTML = '';
    logEl.style.display = 'block';
    progEl.style.display = 'block';
    fillEl.style.width = '0%';
    document.getElementById('ghCommitBtn').disabled = true;

    const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':  'application/json'
    };

    try {
        // Step 1 — fetch current file SHA (needed for update)
        ghLog(`🔍 Fetching current SHA for ${path} on branch "${branch}"…`);
        fillEl.style.width = '20%';

        const getResp = await fetch(`${apiBase}?ref=${branch}`, { headers });

        let sha = null;
        if (getResp.status === 200) {
            const existing = await getResp.json();
            sha = existing.sha;
            ghLog(`✅ File found · SHA ${sha.slice(0, 7)}`, 'log-ok');
        } else if (getResp.status === 404) {
            ghLog(`ℹ️ File not found — will create it`, 'log-warn');
        } else {
            const err = await getResp.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${getResp.status} fetching file`);
        }

        fillEl.style.width = '50%';

        // Step 2 — encode content as Base64
        const jsContent = buildJS();
        // btoa needs a binary string; use TextEncoder → Uint8Array → binary string
        const bytes = new TextEncoder().encode(jsContent);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        const base64Content = btoa(binary);

        ghLog(`📦 Encoded ${(jsContent.length / 1024).toFixed(1)} KB`);
        fillEl.style.width = '65%';

        // Step 3 — PUT the file
        ghLog(`🚀 Committing: "${commitMsg}"…`);

        const body = { message: commitMsg, content: base64Content, branch };
        if (sha) body.sha = sha;

        const putResp = await fetch(apiBase, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        fillEl.style.width = '90%';

        if (putResp.status === 200 || putResp.status === 201) {
            const result = await putResp.json();
            const newSha = result.content?.sha?.slice(0, 7) ?? '?';
            fillEl.style.width = '100%';
            ghLog(``, '');
            ghLog(`✅ Committed! New SHA: ${newSha}`, 'log-ok');
            ghLog(`🔗 ${result.content?.html_url ?? ''}`, 'log-ok');
            showToast(`✅ Pushed to GitHub · ${commitMsg}`);
            // Mark as saved since GitHub now has the latest
            hasUnsaved = false;
            document.getElementById('saveBanner').classList.remove('visible');
        } else {
            const err = await putResp.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${putResp.status} on PUT`);
        }

    } catch (err) {
        fillEl.style.width = '100%';
        fillEl.style.background = '#c9191a';
        ghLog(``, '');
        ghLog(`❌ Error: ${err.message}`, 'log-err');
        showToast('❌ Commit failed — see log');
        console.error(err);
    } finally {
        document.getElementById('ghCommitBtn').disabled = false;
    }
}

document.getElementById('githubModal').addEventListener('click', function (e) {
    if (e.target === this) closeGithubModal();
});

// Update commit message preview whenever the modal is interacted with
document.getElementById('githubModal').addEventListener('input', updateCommitMsgPreview);

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════
init();
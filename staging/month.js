const monthsConfig = {
    1: { name: 'February 2026', emoji: '💝', startDay: 1, endDay: 15 },
    2: { name: 'March', emoji: '🌸', startDay: 16, endDay: 46 },
    3: { name: 'April', emoji: '🌷', startDay: 47, endDay: 76 },
    4: { name: 'May', emoji: '🌹', startDay: 77, endDay: 107 },
    5: { name: 'June', emoji: '☀️', startDay: 108, endDay: 137 },
    6: { name: 'July', emoji: '🌺', startDay: 138, endDay: 168 },
    7: { name: 'August', emoji: '🌻', startDay: 169, endDay: 199 },
    8: { name: 'September', emoji: '🍂', startDay: 200, endDay: 229 },
    9: { name: 'October', emoji: '🎃', startDay: 230, endDay: 260 },
    10: { name: 'November', emoji: '🍁', startDay: 261, endDay: 290 },
    11: { name: 'December', emoji: '❄️', startDay: 291, endDay: 321 },
    12: { name: 'January 2027', emoji: '🎊', startDay: 322, endDay: 352 },
    13: { name: 'February 2027', emoji: '💖', startDay: 353, endDay: 365 }
};

const urlParams = new URLSearchParams(window.location.search);
const monthNum = parseInt(urlParams.get('month')) || 1;
const config = monthsConfig[monthNum];

if (config) {
    document.getElementById('monthTitle').textContent = config.name;
    document.getElementById('monthEmoji').textContent = config.emoji;

    const grid = document.getElementById('calendarGrid');
    const today = new Date();
    const countdownStart = new Date(2026, 1, 9); 
    const openedDays = JSON.parse(localStorage.getItem('openedLoveDays') || '{}');

    for (let day = config.startDay; day <= config.endDay; day++) {
        const cardDate = new Date(countdownStart);
        cardDate.setDate(countdownStart.getDate() + day - 1);
        
        const isUnlocked = today >= cardDate; 
        const card = document.createElement('div');
        card.className = `day-card ${isUnlocked ? 'unlocked' : 'locked'}`;
        
        if (openedDays[`day${day}`]) {
            card.classList.add('checked');
        }

        card.innerHTML = `
            <span class="check-mark">❤️</span>
            <div class="day-number">${isUnlocked ? day : '🔒'}</div>
            <div class="day-label">Day ${day}</div>
        `;

        // Handle touch release to reset swell
        card.ontouchend = () => { card.style.transform = "scale(1)"; };
        
        if (isUnlocked) {
            const dayData = (typeof loveData !== 'undefined') ? loveData[`day${day}`] : null;
            card.onclick = () => {
                card.classList.add('checked');
                saveProgress(day);
                openModal(day, cardDate, dayData);
            };
        } else {
            card.onclick = () => {
                card.classList.add('shake');
                setTimeout(() => card.classList.remove('shake'), 500);
            };
        }
        grid.appendChild(card);
    }
}

function saveProgress(dayNumber) {
    const currentProgress = JSON.parse(localStorage.getItem('openedLoveDays') || '{}');
    currentProgress[`day${dayNumber}`] = true;
    localStorage.setItem('openedLoveDays', JSON.stringify(currentProgress));
}

function openModal(day, date, dayData) {
    document.getElementById('modal').classList.add('active');
    document.getElementById('modalDay').textContent = "Day " + day;
    document.getElementById('modalDate').textContent = date.toLocaleDateString('en-US', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });

    const messageEl = document.getElementById('modalMessage');
    const playerEl = document.getElementById('musicPlayer');

    if (dayData) {
        messageEl.textContent = dayData.message;
        playerEl.innerHTML = dayData.song_embed || "";
    } else {
        messageEl.textContent = "I can't wait to spend this year with you, Isabella. ❤️";
        playerEl.innerHTML = "<p style='color: #800f2f; font-style: italic; opacity: 0.6;'>Song of the day coming soon... 🌹</p>";
    }
}

function closeModal() {
    const modal = document.getElementById('modal');
    const modalContent = modal.querySelector('.modal-content');
    
    // Add closing animation
    modalContent.style.animation = 'modalBlurOut 0.3s cubic-bezier(0.6, 0.04, 0.98, 0.335) forwards';
    
    // Wait for animation to finish before hiding
    setTimeout(() => {
        modal.classList.remove('active');
        document.getElementById('musicPlayer').innerHTML = "";
        // Reset animation for next time
        modalContent.style.animation = '';
    }, 300); // Match animation duration
}

window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target == modal) { closeModal(); }
}
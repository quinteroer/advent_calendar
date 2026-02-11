const installPrompt = document.getElementById('installPrompt');
const isInstalled = window.matchMedia('(display-mode: standalone)').matches;
function checkWelcome() {
    const hasVisited = localStorage.getItem('isabella_welcomed');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    // We only show the welcome if she's in the app (standalone) 
    // AND she hasn't seen it before.
    if (isStandalone && !hasVisited) {
        document.getElementById('welcomeModal').style.display = 'flex';
    }
}

function closeWelcome() {
    // Save to the phone's memory so she never sees it again
    localStorage.setItem('isabella_welcomed', 'true');
    document.getElementById('welcomeModal').style.display = 'none';
}

function transitionToMonth(monthNumber) {
    const allCards = document.querySelectorAll('.month-card');
    
    // 1. Add the exit animation class to all cards for a unified look
    allCards.forEach(card => {
        card.classList.add('exit-animation');
    });

    // 2. Wait for the animation to finish (600ms) before changing the page
    setTimeout(() => {
        window.location.href = `month.html?month=${monthNumber}`;
    }, 550); 
}

// Check if the app is being viewed in the browser or as an installed app
if (!isInstalled) {
    // Show the prompt if we are in the browser
    installPrompt.style.display = 'flex';
} else {
    // Hide it if she's already opened it from her home screen
    installPrompt.style.display = 'none';
}
window.onload = checkWelcome;

// Optional: Log when she clicks download just for your debugging
document.getElementById('installBtn').addEventListener('click', () => {
    console.log('Profile download initiated! 💝');
});

window.addEventListener('pageshow', function(event) {
    // If the page is loaded from the cache (like swiping back)
    if (event.persisted) {
        const allCards = document.querySelectorAll('.month-card');
        allCards.forEach(card => {
            // Remove the animation class so they aren't hidden
            card.classList.remove('exit-animation');
            // Force a quick style reset to ensure they're clickable
            card.style.opacity = "1";
            card.style.transform = "translateZ(0) scale(1)";
        });
        console.log("♻️ Navigation state reset");
    }
});
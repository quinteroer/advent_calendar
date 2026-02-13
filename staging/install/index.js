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
    window.location.href = 'install.mobileconfig';
    localStorage.setItem('isabella_welcomed', 'true');
    document.getElementById('welcomeModal').style.display = 'none';
}

function transitionToMonth(monthNumber) {
    const wrapper = document.getElementById('page-wrapper');
    // 1. Apply the exit animation to the entire body
    wrapper.classList.add('page-exit');

    // 2. Wait for the animation (600ms) before changing the page
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
    if (event.persisted) {
        const wrapper = document.getElementById('page-wrapper');
        if(wrapper) wrapper.classList.remove('page-exit');
    }
});
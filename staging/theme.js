// theme.js
function applyDynamicTheme() {
    const hour = new Date().getHours();
    
    // Day: 7 AM to 7 PM | Night: 7 PM to 7 AM
    const isNight = hour < 7 || hour >= 19;
    
    if (isNight) {
        document.documentElement.setAttribute('data-theme', 'dark');
        console.log("🌙 Night mode active");
    } else {
        document.documentElement.removeAttribute('data-theme');
        console.log("☀️ Day mode active");
    }
}

// Run immediately and check every minute
applyDynamicTheme();
setInterval(applyDynamicTheme, 60000);
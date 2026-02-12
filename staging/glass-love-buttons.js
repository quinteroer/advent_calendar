// glass-love-buttons.js
// Ready-to-use glass components for your 365 Days of Love app
// Just add this script to your HTML: <script src="glass-love-buttons.js"></script>

window.addEventListener('load', () => {
    // Wait for page to fully render before creating glass elements
    // This is important so the components can capture the page background
    setTimeout(initGlassComponents, 1500);
});

function initGlassComponents() {
    // Apply WebGL glass to all existing .glass elements on the page
    applyGlassToElements();
    
    // Add special navigation on month pages
    if (window.location.href.includes('month.html')) {
        addGlassMonthNavigation();
    }
}

// 🪟 Applies the WebGL Container glass effect to every element with class "glass"
// This injects a WebGL canvas as the background layer without changing the DOM structure,
// so all existing click handlers, styles, and content remain intact.
function applyGlassToElements() {
    const glassElements = document.querySelectorAll('.glass');
    
    glassElements.forEach(el => {
        // Skip elements that already have a glass canvas injected
        if (el.querySelector('canvas.glass-webgl-canvas')) return;

        // Ensure the element is relatively positioned so the canvas can be absolute inside it
        const currentPosition = window.getComputedStyle(el).position;
        if (currentPosition === 'static') {
            el.style.position = 'relative';
        }

        // Read the element's border-radius to match in WebGL
        const computedStyle = window.getComputedStyle(el);
        const borderRadiusPx = parseFloat(computedStyle.borderRadius) || 28;

        // Create a Container purely to get its WebGL canvas — we borrow just the canvas
        const container = new Container({
            borderRadius: borderRadiusPx,
            type: 'rounded',
            tintOpacity: 0.18
        });

        // Detach the element Container created (we don't need it in the DOM)
        // Instead, take the canvas and inject it directly into the .glass element
        const canvas = container.canvas;
        canvas.classList.add('glass-webgl-canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.borderRadius = 'inherit';
        canvas.style.zIndex = '0';
        canvas.style.pointerEvents = 'none';

        // Insert canvas as first child so it's behind all content
        el.insertBefore(canvas, el.firstChild);

        // Re-point container's element reference to the actual .glass element
        // so getPosition() and updateSizeFromDOM() work correctly
        container.element = el;

        // Ensure all direct children of the .glass element sit above the canvas
        Array.from(el.children).forEach(child => {
            if (child !== canvas) {
                const childZ = window.getComputedStyle(child).zIndex;
                if (childZ === 'auto' || childZ === '0') {
                    child.style.position = 'relative';
                    child.style.zIndex = '1';
                }
            }
        });

        // Trigger a size update now that the canvas is in the real DOM
        container.updateSizeFromDOM();
    });
}

// 🏠 Glass navigation for month pages
function addGlassMonthNavigation() {
    // Create a pill-shaped glass container
    const navContainer = new Container({
        borderRadius: 50,
        type: 'pill',
        tintOpacity: 0.25
    });
    
    // Home button
    const homeButton = new Button({
        text: '🏠 Home',
        size: 18,
        type: 'pill',
        onClick: () => {
            // Use the existing transition animation
            const wrapper = document.getElementById('page-wrapper');
            if (wrapper) {
                wrapper.classList.add('page-exit');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 550);
            } else {
                window.location.href = 'index.html';
            }
        }
    });
    
    navContainer.addChild(homeButton);
    
    // Position at bottom center
    navContainer.element.style.position = 'fixed';
    navContainer.element.style.bottom = '20px';
    navContainer.element.style.left = '50%';
    navContainer.element.style.transform = 'translateX(-50%)';
    navContainer.element.style.zIndex = '1000';
    
    document.body.appendChild(navContainer.element);
}

// 🎨 Optional: Create a glass control panel with multiple buttons
// Uncomment this function and call it in initGlassComponents() to use it
/*
function createGlassControlPanel() {
    const panel = new Container({
        borderRadius: 40,
        type: 'rounded',
        tintOpacity: 0.25
    });
    
    // Array of control buttons
    const controls = [
        { emoji: '🏠', label: 'Home', action: () => window.location.href = 'index.html' },
        { emoji: '📅', label: 'Today', action: findTodayCard },
        { emoji: '❤️', label: 'Love', action: showLoveMessage },
        { emoji: '🎵', label: 'Music', action: () => alert('Music feature coming soon!') }
    ];
    
    controls.forEach(({ emoji, label, action }) => {
        const btn = new Button({
            text: emoji,
            size: 24,
            type: 'circle',
            onClick: action
        });
        panel.addChild(btn);
    });
    
    panel.element.style.position = 'fixed';
    panel.element.style.top = '20px';
    panel.element.style.left = '50%';
    panel.element.style.transform = 'translateX(-50%)';
    panel.element.style.zIndex = '1000';
    
    document.body.appendChild(panel.element);
}

function findTodayCard() {
    const today = new Date();
    const countdownStart = new Date(2026, 1, 14); // Feb 14, 2026
    const dayDiff = Math.floor((today - countdownStart) / (1000 * 60 * 60 * 24)) + 1;
    
    if (dayDiff >= 1 && dayDiff <= 365) {
        alert(`Today is Day ${dayDiff}! 💕`);
        // Could also navigate to the appropriate month
    } else {
        alert('The journey hasn\'t started yet! 💕');
    }
}
*/
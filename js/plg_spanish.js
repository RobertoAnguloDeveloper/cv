// Navigation functionality
document.addEventListener('DOMContentLoaded', function() {
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navbar = document.getElementById('navbar');
    
    // Mobile menu toggle
    navToggle.addEventListener('click', function() {
        navMenu.classList.toggle('active');
        navToggle.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function() {
            navMenu.classList.remove('active');
            navToggle.classList.remove('active');
        });
    });

    // Navbar scroll effect
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Initialize animations
    initializeAnimations();
    
    // Initialize solution tabs
    initializeSolutionTabs();
    
    // Initialize service flow animation
    initializeServiceFlow();
    
    // Initialize counter animations
    initializeCounters();
    
    // Initialize form handling
    initializeFormHandling();
});

// Smooth scroll to section function
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Initialize animations on scroll
function initializeAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('aos-animate');
            }
        });
    }, observerOptions);

    // Observe all elements with data-aos attributes
    document.querySelectorAll('[data-aos]').forEach(el => {
        observer.observe(el);
    });
}

// Solution tabs functionality
function initializeSolutionTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
}

// Service flow animation
function initializeServiceFlow() {
    const flowSteps = document.querySelectorAll('.flow-step');
    let currentStep = 0;

    function animateSteps() {
        // Remove active class from all steps
        flowSteps.forEach(step => step.classList.remove('active'));
        
        // Add active class to current step
        if (flowSteps[currentStep]) {
            flowSteps[currentStep].classList.add('active');
        }
        
        // Move to next step
        currentStep = (currentStep + 1) % flowSteps.length;
    }

    // Start animation
    if (flowSteps.length > 0) {
        animateSteps(); // Show first step immediately
        setInterval(animateSteps, 3000); // Change every 3 seconds
    }
}

// Counter animations
function initializeCounters() {
    const counters = document.querySelectorAll('.stat-number[data-target]');
    
    const counterObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => {
        counterObserver.observe(counter);
    });
}

function animateCounter(element) {
    const target = parseInt(element.getAttribute('data-target'));
    const duration = 2000; // 2 seconds
    const step = target / (duration / 16); // 60fps
    let current = 0;

    const timer = setInterval(() => {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 16);
}

// ROI Calculator
function calculateROI() {
    const monthlyVolume = parseFloat(document.getElementById('monthly-volume').value) || 0;
    const fuelPrice = parseFloat(document.getElementById('fuel-price').value) || 0;
    const currentLoss = parseFloat(document.getElementById('current-loss').value) || 0;
    const employees = parseInt(document.getElementById('employees').value) || 0;

    // Assumptions for calculations
    const lossReduction = 0.8; // 80% reduction in losses
    const hoursSavedPerMonth = employees * 8; // 8 hours saved per employee per month
    const hourlyWage = 15000; // COP per hour
    const systemCost = 25000000; // COP (approximately $6,250 USD)
    const annualSubscription = 3600000; // COP (approximately $900 USD)
    const uptimeDays = 2; // Days of downtime prevented per year
    const dailyRevenue = (monthlyVolume * fuelPrice * 0.05) / 30; // 5% margin assumption

    // Calculate savings
    const fuelSavings = (monthlyVolume * (currentLoss / 100) * lossReduction * fuelPrice * 12);
    const laborSavings = (hoursSavedPerMonth * hourlyWage * 12);
    const uptimeSavings = (dailyRevenue * uptimeDays);
    
    const totalAnnualSavings = fuelSavings + laborSavings + uptimeSavings;
    const totalInvestment = systemCost + annualSubscription;
    
    const paybackMonths = Math.ceil(totalInvestment / (totalAnnualSavings / 12));
    const threeYearROI = ((totalAnnualSavings * 3 - totalInvestment - (annualSubscription * 2)) / totalInvestment * 100);

    // Update display
    document.getElementById('annual-savings').textContent = formatCurrency(totalAnnualSavings);
    document.getElementById('payback-period').textContent = paybackMonths;
    document.getElementById('roi-percentage').textContent = Math.round(threeYearROI) + '%';
    
    document.getElementById('fuel-savings').textContent = formatCurrency(fuelSavings);
    document.getElementById('labor-savings').textContent = formatCurrency(laborSavings);
    document.getElementById('uptime-savings').textContent = formatCurrency(uptimeSavings);

    // Animate the results
    animateResults();
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function animateResults() {
    const resultCards = document.querySelectorAll('.result-card');
    resultCards.forEach((card, index) => {
        card.style.transform = 'scale(0.9)';
        card.style.opacity = '0.5';
        
        setTimeout(() => {
            card.style.transform = 'scale(1)';
            card.style.opacity = '1';
            card.style.transition = 'all 0.3s ease';
        }, index * 100);
    });
}

// Form handling
function initializeFormHandling() {
    const contactForm = document.getElementById('contact-form');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(this);
            const data = Object.fromEntries(formData);
            
            // Simulate form submission
            submitForm(data);
        });
    }
}

function submitForm(data) {
    // Show loading state
    const submitButton = document.querySelector('#contact-form button[type="submit"]');
    const originalText = submitButton.innerHTML;
    
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    submitButton.disabled = true;
    
    // Simulate API call
    setTimeout(() => {
        // Show success message
        showNotification('¡Gracias por su interés! Nos pondremos en contacto pronto.', 'success');
        
        // Reset form
        document.getElementById('contact-form').reset();
        
        // Reset button
        submitButton.innerHTML = originalText;
        submitButton.disabled = false;
        
        // Log form data (in real implementation, send to server)
        console.log('Form submitted:', data);
    }, 2000);
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 5000);
}

// Initialize calculator with default calculation
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        calculateROI();
    }, 1000);
});

// Parallax effect for hero section
window.addEventListener('scroll', function() {
    const scrolled = window.pageYOffset;
    const parallaxElements = document.querySelectorAll('.floating-particles');
    
    parallaxElements.forEach(element => {
        const speed = 0.5;
        element.style.transform = `translateY(${scrolled * speed}px)`;
    });
});

// Add loading animation
window.addEventListener('load', function() {
    document.body.classList.add('loaded');
});
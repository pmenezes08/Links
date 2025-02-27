document.addEventListener('DOMContentLoaded', function() {
    console.log("Document loaded");

    // Check for jQuery
    if (typeof $ === 'undefined') {
        console.error("jQuery not loaded - critical features disabled");
        const popupContent = document.querySelector('#intro-popup .popup-content');
        if (popupContent) {
            popupContent.innerHTML = '<p class="error-message">jQuery failed to load. Please refresh the page.</p>';
        }
        return;
    }
    console.log("jQuery loaded successfully");

    // SSO Error Handling from URL Params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('error')) {
        const error = urlParams.get('error');
        const errorDesc = urlParams.get('error_description');
        console.error(`SSO Error: ${error} - ${errorDesc}`);
        const popupContent = $('#intro-popup .popup-content');
        popupContent.append(`<p class="error-message">SSO Failed: ${errorDesc || error}</p>`);
    }

    // X Login Button Click (for consistency, though <a> href works too)
    const xLoginBtn = document.getElementById('x-login-btn');
    if (xLoginBtn) {
        xLoginBtn.addEventListener('click', function(e) {
            console.log("Initiating X SSO login...");
            // Let the <a> href handle navigation to /login_x
        });
    }

    // Workout Generation (assuming this will be added to other pages like free_workouts.html)
    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            const muscleSelect = document.getElementById('muscle-select');
            const typeSelect = document.getElementById('type-select');
            const muscle = muscleSelect ? muscleSelect.value : '';
            const trainingType = typeSelect ? typeSelect.value : '';
            const subscription = window.location.pathname.includes('free') ? 'free' : 'premium';
            const result = document.getElementById('result');

            if (!muscle || !trainingType || !result) {
                if (result) {
                    result.innerHTML = '<span class="error-message">Please select a muscle group and training type!</span>';
                }
                console.warn("Missing muscle, training type, or result element");
                return;
            }

            $.ajax({
                url: '/generate_workout',
                type: 'POST',
                data: {
                    muscle: muscle,
                    training_type: trainingType,
                    subscription: subscription
                },
                cache: false,
                success: function(response) {
                    if (response.error) {
                        result.innerHTML = `<span class="error-message">${response.error}</span>`;
                        console.warn("Workout generation error:", response.error);
                    } else {
                        result.innerHTML = response.workout;
                        $(result).css('opacity', 0).animate({ opacity: 1 }, 500);
                        console.log("Workout generated:", response.workout);
                    }
                },
                error: function(xhr, status, error) {
                    if (xhr.status === 401) {
                        result.innerHTML = '<span class="error-message">Please log in to generate workouts! <a href="/login_x">Log in with X</a></span>';
                        console.warn("Unauthorized - redirecting to login");
                    } else {
                        result.innerHTML = '<span class="error-message">Error generating workout!</span>';
                        console.error("AJAX error:", status, error, xhr.responseText);
                    }
                }
            });
        });
    }

    // Check Login Status on Load
    $.get('/free_workouts', function(data) {
        if (!data.includes('name')) {
            console.warn("User not logged in - SSO may be required");
        } else {
            console.log("User logged in - ready for action");
        }
    }).fail(function(xhr) {
        console.error("Failed to check user status:", xhr.status, xhr.responseText);
    });
});
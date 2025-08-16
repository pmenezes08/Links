// static/script.js

document.addEventListener('DOMContentLoaded', function() {
    console.log("script.js loaded, jQuery version:", jQuery.fn.jquery);

    // Ensure jQuery is loaded
    if (typeof jQuery === 'undefined') {
        console.error("jQuery is not loaded. Please ensure <script src='https://code.jquery.com/jquery-3.6.0.min.js'></script> is included.");
        return;
    }

    // CSRF + username bootstrap from meta
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    const currentUsernameMeta = document.querySelector('meta[name="current-username"]')?.getAttribute('content') || '';
    if (currentUsernameMeta) {
        try { sessionStorage.setItem('username', currentUsernameMeta); } catch (e) {}
    }
    if (csrfToken && $.ajaxSetup) {
        $.ajaxSetup({ headers: { 'X-CSRFToken': csrfToken } });
    }

    // Menu Toggle and Click-Outside Functionality
    const $menuBtn = $('.menu-btn');
    const $dropdown = $('.dropdown-content');

    if ($menuBtn.length && $dropdown.length) {
        $menuBtn.off('click');

        $menuBtn.on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $dropdown.toggle();
            console.log("Menu toggled, dropdown display:", $dropdown.css('display'));
        });

        $menuBtn.css('pointer-events', 'auto');

        $(window).on('resize', function() {
            if ($(window).width() > 768) {
                $dropdown.hide();
            }
        });

        // Close dropdown when clicking a menu item on mobile
        $dropdown.on('click', 'a', function() {
            if ($(window).width() <= 600) {
                $dropdown.hide();
            }
        });

        // Hide dropdown on click outside
        $(document).on('click', function(e) {
            if ($dropdown.is(':visible')) {
                const $target = $(e.target);
                const isMenuBtnClicked = $target.closest($menuBtn).length > 0;
                const isDropdownClicked = $target.closest($dropdown).length > 0;
                if (!isMenuBtnClicked && !isDropdownClicked) {
                    $dropdown.hide();
                }
            }
        });

        // Prevent dropdown from closing if clicking inside
        $dropdown.on('click', function(e) {
            e.stopPropagation();
        });

        $dropdown.hide();
    } else {
        console.error("Menu elements not found:", { $menuBtn, $dropdown });
    }

    // Unread Badge Polling (for pages with #unread-badge)
    const $unreadBadge = $('#unread-badge');
    if ($unreadBadge.length) {
        function checkUnreadMessages() {
            if (sessionStorage.getItem('username')) {
                $.get('/check_unread_messages')
                    .done(function(data) {
                        const unreadCount = data.unread_count;
                        if (unreadCount > 0) {
                            $unreadBadge.text(unreadCount > 9 ? '9+' : unreadCount).removeClass('hidden');
                        } else {
                            $unreadBadge.addClass('hidden');
                        }
                    })
                    .fail(function(xhr, status, error) {
                        console.error('Error checking unread messages:', error);
                    });
            }
        }

        checkUnreadMessages();
        setInterval(checkUnreadMessages, 5000);
    }

    // Workout Generation (for Premium Dashboard)
    const $workoutForm = $('form[action="/generate_workout"]');
    const $saveBtn = $('#save-btn');
    const $resultDiv = $('#result');
    let isGenerating = false;

    if ($workoutForm.length && $saveBtn.length && $resultDiv.length) {
        $workoutForm.on('submit', function(e) {
            e.preventDefault();
            if (!isGenerating) {
                isGenerating = true;
                $resultDiv.hide();
                const formData = new FormData(this);
                fetch('/generate_workout', {
                    method: 'POST',
                    body: formData
                })
                .then(response => response.json())
                .then(data => {
                    isGenerating = false;
                    if (data.error) {
                        $resultDiv.html('<p style="color: #e0e0e0;">' + data.error + '</p>').show();
                    } else {
                        $resultDiv.html('<h3 class="result-title">Workout Generated</h3><div class="workout-content">' + data.workout + '</div>').show();
                        $saveBtn.show();
                    }
                })
                .catch(error => {
                    isGenerating = false;
                    $resultDiv.html('<p style="color: #e0e0e0;">Error: ' + error + '</p>').show();
                });
            }
        });

        $saveBtn.on('click', function() {
            const workout = $resultDiv.html();
            fetch('/save_workout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'workout=' + encodeURIComponent(workout)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    $resultDiv.after('<div class="success-message">Workout saved successfully!</div>');
                    $saveBtn.hide();
                    setTimeout(() => $('.success-message').remove(), 3000);
                } else {
                    $resultDiv.after(`<div class="error-message">Error saving workout: ${data.error}</div>`);
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            })
            .catch(error => {
                $resultDiv.after(`<div class="error-message">Error: ${error}</div>`);
                setTimeout(() => $('.error-message').remove(), 3000);
            });
        });
    }

    // Social Feed Interactivity (for feed.html)
    const $postForm = $('form[action="/post_status"]');
    const $postContainer = $('.posts');

    function updateReactionIconStates($reactions, activeType) {
        $reactions.find('.reaction-btn').each(function() {
            const $btn = $(this);
            const $icon = $btn.find('i');
            $btn.removeClass('active');
            $icon.removeClass('fa-solid').addClass('fa-regular');
        });
        if (activeType) {
            const $activeBtn = $reactions.find(`[data-reaction="${activeType}"]`);
            $activeBtn.addClass('active');
            $activeBtn.find('i').removeClass('fa-regular').addClass('fa-solid');
        }
    }

    if ($postForm.length && $postContainer.length) {
        console.log("Social feed elements initialized:", { $postForm, $postContainer });

        // Initialize icons for pre-active reactions on page load
        $('.reactions').each(function() {
            const $reactions = $(this);
            const $active = $reactions.find('.reaction-btn.active').first();
            const activeType = $active.data('reaction');
            if (activeType) {
                updateReactionIconStates($reactions, activeType);
            }
        });

        // Handle post submission
        $postForm.on('submit', function(e) {
            e.preventDefault();
            const content = $(this).find('input[name="content"]').val().trim();
            if (!content) {
                $postForm.after('<div class="error-message">Post content cannot be empty!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            console.log("Submitting post with content:", content);
            $.ajax({
                url: '/post_status',
                method: 'POST',
                data: { content },
                beforeSend: function() {
                    $postForm.append('<div class="loader"></div>');
                },
                success: function(data) {
                    $postForm.find('.loader').remove();
                    console.log("Post submission response:", data);
                    if (data.success) {
                        const postHtml = `
                            <div class="post" data-post-id="${data.post.id}">
                                <p><strong>@${data.post.username}</strong> <span>${data.post.timestamp}</span></p>
                                <p>${data.post.content}</p>
                                <div class="post-actions">
                                    <div class="reactions">
                                        <button class="reaction-btn heart" data-reaction="heart" aria-label="Like post"><i class="far fa-heart"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-up" data-reaction="thumbs-up" aria-label="Thumbs up"><i class="far fa-thumbs-up"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-down" data-reaction="thumbs-down" aria-label="Thumbs down"><i class="far fa-thumbs-down"></i> <span>0</span></button>
                                    </div>
                                    ${data.post.username === sessionStorage.getItem('username') ? '<button class="delete-post inline-action" data-post-id="' + data.post.id + '"><i class="far fa-trash-alt"></i> Delete</button>' : ''}
                                </div>
                                <form class="reply-form" action="/post_reply" method="POST">
                                    <input type="hidden" name="post_id" value="${data.post.id}">
                                    <input type="text" name="content" placeholder="Write a reply..." required>
                                    <button type="submit" class="sleek-btn small">Reply</button>
                                </form>
                                <div class="replies"></div>
                            </div>`;
                        $postContainer.prepend(postHtml);
                        $postForm.find('input[name="content"]').val('');
                        $postForm.after('<div class="success-message">Post added!</div>');
                        setTimeout(() => $('.success-message').remove(), 3000);
                    } else {
                        $postForm.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    $postForm.find('.loader').remove();
                    console.error("Post submission error:", { status, error, response: xhr.responseText });
                    $postForm.after('<div class="error-message">Error posting status. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle reply submission
        $postContainer.on('submit', '.reply-form', function(e) {
            e.preventDefault();
            const $form = $(this);
            const postId = $form.find('input[name="post_id"]').val();
            const content = $form.find('input[name="content"]').val().trim();
            if (!content) {
                $form.after('<div class="error-message">Reply content cannot be empty!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            console.log("Submitting reply for post", postId, "with content:", content);
            $.ajax({
                url: '/post_reply',
                method: 'POST',
                data: { post_id: postId, content },
                beforeSend: function() {
                    $form.append('<div class="loader"></div>');
                },
                success: function(data) {
                    $form.find('.loader').remove();
                    console.log("Reply submission response:", data);
                    if (data.success) {
                        const $replies = $form.siblings('.replies');
                        const replyHtml = `
                            <div class="reply" data-reply-id="${data.reply.id}">
                                <p><strong>@${data.reply.username}</strong> <span>${data.reply.timestamp}</span></p>
                                <p>${data.reply.content}</p>
                                ${data.reply.username === sessionStorage.getItem('username') ? '<button class="delete-reply inline-action" data-reply-id="' + data.reply.id + '"><i class="far fa-trash-alt"></i> Delete</button>' : ''}
                            </div>`;
                        $replies.append(replyHtml);
                        $form.find('input[name="content"]').val('');
                        $form.after('<div class="success-message">Reply added!</div>');
                        setTimeout(() => $('.success-message').remove(), 3000);
                    } else {
                        $form.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    $form.find('.loader').remove();
                    console.error("Reply submission error:", { status, error, response: xhr.responseText });
                    $form.after('<div class="error-message">Error posting reply. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle reaction clicks
        $postContainer.on('click', '.reaction-btn', function(e) {
            e.preventDefault();
            const $button = $(this);
            const postId = $button.closest('.post').data('post-id');
            const reactionType = $button.data('reaction');
            const validReactions = ['heart', 'thumbs-up', 'thumbs-down'];
            if (!validReactions.includes(reactionType)) {
                $button.after('<div class="error-message">Invalid reaction type!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            console.log("Reaction clicked:", { postId, reactionType });
            $.ajax({
                url: '/add_reaction',
                method: 'POST',
                data: { post_id: postId, reaction: reactionType },
                beforeSend: function() {
                    $button.append('<div class="loader"></div>');
                },
                success: function(data) {
                    $button.find('.loader').remove();
                    console.log("Reaction response:", data);
                    if (data.success) {
                        const $reactions = $button.closest('.reactions');
                        $reactions.find('.reaction-btn span').text(0); // Reset all counts
                        Object.keys(data.counts).forEach(type => {
                            $reactions.find(`[data-reaction="${type}"] span`).text(data.counts[type] || 0);
                        });
                        updateReactionIconStates($reactions, data.user_reaction);
                    } else {
                        $button.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    $button.find('.loader').remove();
                    console.error("Reaction error:", { status, error, response: xhr.responseText });
                    $button.after('<div class="error-message">Error adding reaction. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle post deletion
        $postContainer.on('click', '.delete-post', function(e) {
            e.preventDefault();
            const postId = $(this).data('post-id');
            if (confirm('Are you sure you want to delete this post?')) {
                console.log("Deleting post:", postId);
                $.ajax({
                    url: '/delete_post',
                    method: 'POST',
                    data: { post_id: postId },
                    beforeSend: function() {
                        $(`[data-post-id="${postId}"]`).append('<div class="loader"></div>');
                    },
                    success: function(data) {
                        $(`[data-post-id="${postId}"] .loader`).remove();
                        console.log("Delete post response:", data);
                        if (data.success) {
                            $(`[data-post-id="${postId}"]`).remove();
                            $postContainer.after('<div class="success-message">Post deleted!</div>');
                            setTimeout(() => $('.success-message').remove(), 3000);
                        } else {
                            $postContainer.after(`<div class="error-message">Error: ${data.error}</div>`);
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    },
                    error: function(xhr, status, error) {
                        $(`[data-post-id="${postId}"] .loader`).remove();
                        console.error("Delete post error:", { status, error, response: xhr.responseText });
                        $postContainer.after('<div class="error-message">Error deleting post. Please try again.</div>');
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                });
            }
        });

        // Handle reply deletion
        $postContainer.on('click', '.delete-reply', function(e) {
            e.preventDefault();
            const replyId = $(this).data('reply-id');
            if (confirm('Are you sure you want to delete this reply?')) {
                console.log("Deleting reply:", replyId);
                $.ajax({
                    url: '/delete_reply',
                    method: 'POST',
                    data: { reply_id: replyId },
                    beforeSend: function() {
                        $(`[data-reply-id="${replyId}"]`).append('<div class="loader"></div>');
                    },
                    success: function(data) {
                        $(`[data-reply-id="${replyId}"] .loader`).remove();
                        console.log("Delete reply response:", data);
                        if (data.success) {
                            $(`[data-reply-id="${replyId}"]`).remove();
                            $postContainer.after('<div class="success-message">Reply deleted!</div>');
                            setTimeout(() => $('.success-message').remove(), 3000);
                        } else {
                            $postContainer.after(`<div class="error-message">Error: ${data.error}</div>`);
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    },
                    error: function(xhr, status, error) {
                        $(`[data-reply-id="${replyId}"] .loader`).remove();
                        console.error("Delete reply error:", { status, error, response: xhr.responseText });
                        $postContainer.after('<div class="error-message">Error deleting reply. Please try again.</div>');
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                });
            }
        });
    }
});

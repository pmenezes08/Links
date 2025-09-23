// static/script.js

function handleImageError(imgElement) {
    console.log('Image failed to load:', imgElement.src);
    imgElement.style.display = 'none';
    imgElement.parentElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #9fb0b5;">Image could not be loaded</div>';
}

document.addEventListener('DOMContentLoaded', function() {
    console.log("script.js loaded, jQuery version:", jQuery.fn.jquery);

    // Ensure jQuery is loaded
    if (typeof jQuery === 'undefined') {
        console.error("jQuery is not loaded. Please ensure <script src='https://code.jquery.com/jquery-3.6.0.min.js'></script> is included.");
        return;
    }

    // CSRF + username bootstrap from meta
    const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfTokenMeta ? csrfTokenMeta.getAttribute('content') : '';
    const currentUsernameMeta = document.querySelector('meta[name="current-username"]');
    const currentUsername = currentUsernameMeta ? currentUsernameMeta.getAttribute('content') : '';
    if (currentUsername) {
        try { sessionStorage.setItem('username', currentUsername); } catch (e) {}
    }
    if (csrfToken && $.ajaxSetup) {
        $.ajaxSetup({ headers: { 'X-CSRF-Token': csrfToken } });
    }

    // Menu Toggle and Click-Outside Functionality
    const $menuBtn = $('.menu-btn');
    const $dropdown = $('.dropdown-content');

    if ($menuBtn.length && $dropdown.length) {
        $menuBtn.off('click');
        $dropdown.hide();

        $menuBtn.on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            $dropdown.toggle();
        });

        $(document).on('click', function(e) {
            const $target = $(e.target);
            if (!$target.closest('.menu-btn').length && !$target.closest('.dropdown-content').length) {
                $dropdown.hide();
            }
        });

        $(window).on('resize', function() {
            if ($(window).width() > 768) {
                $dropdown.hide();
            }
        });

        $dropdown.on('click', 'a', function() { if ($(window).width() <= 600) { $dropdown.hide(); } });
    }
    // No error logging needed - menu elements are optional on some pages

    // Global go-back button: route to dashboard
    $(document).on('click', '.go-back-btn', function(e) {
        e.preventDefault();
        window.location.href = '/dashboard';
    });

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

    // Social Interactivity (for feed.html)
    const $postForm = $('form[action="/post_status"]');
    const $postContainer = $('.posts');

    // CSRF header already set above

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
        console.log("Social elements initialized:", { $postForm, $postContainer });

        // Initialize icons for pre-active reactions on page load
        $('.reactions').each(function() {
            const $reactions = $(this);
            const $active = $reactions.find('.reaction-btn.active').first();
            const activeType = $active.data('reaction');
            if (activeType) {
                updateReactionIconStates($reactions, activeType);
            }
        });

        // Handle file upload
        $('#image-upload').on('change', function() {
            const file = this.files[0];
            if (file) {
                $('#selected-file-name').text(file.name);
                
                // Show image preview
                const reader = new FileReader();
                reader.onload = function(e) {
                    let previewHtml = $('#image-preview');
                    if (previewHtml.length === 0) {
                        previewHtml = $('<div id="image-preview" class="image-preview"></div>');
                        $('#image-upload').after(previewHtml);
                    }
                    previewHtml.html(`
                        <div class="preview-container">
                            <img src="${e.target.result}" alt="Preview" style="max-width: 200px; max-height: 200px; border-radius: 6px;">
                            <button type="button" class="remove-image" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">×</button>
                        </div>
                    `);
                };
                reader.readAsDataURL(file);
            } else {
                $('#selected-file-name').text('');
                $('#image-preview').remove();
            }
        });

        // Handle remove image preview
        $(document).on('click', '.remove-image', function() {
            $('#image-upload').val('');
            $('#selected-file-name').text('');
            $('#image-preview').remove();
        });

        // Handle post submission
        $postForm.on('submit', function(e) {
            e.preventDefault();
            const content = $(this).find('textarea[name="content"], input[name="content"]').val().trim();
            const imageFile = $('#image-upload')[0].files[0];
            
            if (!content && !imageFile) {
                $postForm.after('<div class="error-message">Post content or image is required!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            
            const formData = new FormData();
            formData.append('content', content);
            formData.append('csrf_token', $('meta[name="csrf-token"]').attr('content'));
            
            // Add community_id if it exists in the form
            const communityId = $postForm.find('input[name="community_id"]').val();
            if (communityId) {
                formData.append('community_id', communityId);
            }
            
            if (imageFile) {
                formData.append('image', imageFile);
            }
            
            console.log("Submitting post with content:", content);
            $.ajax({
                url: '/post_status',
                method: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function(data) {
                    console.log("Post submission response:", data);
                    if (data.success) {
                                    const imageHtml = data.post.image_path ?
                `<div class="post-image"><img src="/uploads/${data.post.image_path.replace('uploads/', '')}" alt="Post image" loading="lazy" onerror="handleImageError(this)" onload="console.log('Image loaded successfully:', this.src);" style="display: block;"></div>` : '';
                        
                        const postHtml = `
                            <div class="post clickable-post" data-post-id="${data.post.id}">
                                <div class="post-header"><strong>@${data.post.username}</strong><span class="timestamp">${data.post.timestamp}</span></div>
                                <p>${data.post.content}</p>
                                ${imageHtml}
                                <div class="post-actions">
                                    <div class="reactions">
                                        <button class="reaction-btn heart" data-reaction="heart" aria-label="Like post"><i class="far fa-heart"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-up" data-reaction="thumbs-up" aria-label="Thumbs up"><i class="far fa-thumbs-up"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-down" data-reaction="thumbs-down" aria-label="Thumbs down"><i class="far fa-thumbs-down"></i> <span>0</span></button>
                                    </div>
                                    ${data.post.username === sessionStorage.getItem('username') ? '<button class="delete-post inline-action" data-post-id="' + data.post.id + '" title="Delete"><i class="far fa-trash-alt"></i></button>' : ''}
                                </div>
                                <div class="reply-indicator">
                                    <i class="far fa-comment"></i> 0 replies
                                </div>
                            </div>`;
                        $postContainer.prepend(postHtml);
                        $postForm.find('textarea[name="content"], input[name="content"]').val('');
                        $('#image-upload').val('');
                        $('#selected-file-name').text('');
                        $('#image-preview').remove();

                    } else {
                        $postForm.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Post submission error:", { status, error, response: xhr.responseText });
                    $postForm.after('<div class="error-message">Error posting status. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle reply submission (for old reply forms in main feed - not used anymore)
        $postContainer.on('submit', '.reply-form', function(e) {
            e.preventDefault();
            const $form = $(this);
            const postId = $form.find('input[name="post_id"]').val();
            const content = $form.find('textarea[name="content"], input[name="content"]').val().trim();
            const imageFile = $form.find('input[type="file"]')[0]?.files[0];
            
            if (!content && !imageFile) {
                $form.after('<div class="error-message">Reply content or image is required!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            console.log("Submitting reply for post", postId, "with content:", content);
            $.ajax({
                url: '/post_reply',
                method: 'POST',
                data: { post_id: postId, content },
                success: function(data) {
                    console.log("Reply submission response:", data);
                    if (data.success) {
                        const $replies = $form.siblings('.replies');
                        const replyHtml = `
                            <div class="reply" data-reply-id="${data.reply.id}">
                                <div class="reply-header"><strong>@${data.reply.username}</strong><span class="timestamp">${data.reply.timestamp}</span></div>
                                <p>${data.reply.content}</p>
                                <div class="reply-actions">
                                    <div class="reactions">
                                        <button class="reaction-btn heart" data-reaction="heart" aria-label="Like reply"><i class="far fa-heart"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-up" data-reaction="thumbs-up" aria-label="Thumbs up reply"><i class="far fa-thumbs-up"></i> <span>0</span></button>
                                        <button class="reaction-btn thumbs-down" data-reaction="thumbs-down" aria-label="Thumbs down reply"><i class="far fa-thumbs-down"></i> <span>0</span></button>
                                    </div>
                                    ${data.reply.username === sessionStorage.getItem('username') ? '<button class="delete-reply inline-action" data-reply-id="' + data.reply.id + '" title="Delete"><i class="far fa-trash-alt"></i></button>' : ''}
                                </div>
                            </div>`;
                        $replies.append(replyHtml);
                        $form.find('textarea[name="content"], input[name="content"]').val('');
                    } else {
                        $form.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Reply submission error:", { status, error, response: xhr.responseText });
                    $form.after('<div class="error-message">Error posting reply. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle reaction clicks for posts
        $postContainer.on('click', '.post > .post-actions .reactions .reaction-btn', function(e) {
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
            console.log("Reaction clicked (post):", { postId, reactionType });
            $.ajax({
                url: '/add_reaction',
                method: 'POST',
                data: { 
                    post_id: postId, 
                    reaction: reactionType,
                    csrf_token: $('meta[name="csrf-token"]').attr('content')
                },
                success: function(data) {
                    if (data.success) {
                        const $reactions = $button.closest('.reactions');
                        $reactions.find('.reaction-btn span').text(0);
                        Object.keys(data.counts).forEach(type => {
                            $reactions.find(`[data-reaction="${type}"] span`).text(data.counts[type] || 0);
                        });
                        updateReactionIconStates($reactions, data.user_reaction);
                        
                        // Trigger immediate notification check for the post owner
                        if (window.triggerNotificationCheck) {
                            window.triggerNotificationCheck();
                        }
                    } else {
                        $button.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
                    $button.after('<div class="error-message">Error adding reaction. Please try again.</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                }
            });
        });

        // Handle reaction clicks for replies
        $postContainer.on('click', '.reply .reactions .reaction-btn', function(e) {
            e.preventDefault();
            const $button = $(this);
            const replyId = $button.closest('.reply').data('reply-id');
            const reactionType = $button.data('reaction');
            const validReactions = ['heart', 'thumbs-up', 'thumbs-down'];
            if (!validReactions.includes(reactionType)) {
                $button.after('<div class="error-message">Invalid reaction type!</div>');
                setTimeout(() => $('.error-message').remove(), 3000);
                return;
            }
            console.log("Reaction clicked (reply):", { replyId, reactionType });
            $.ajax({
                url: '/add_reply_reaction',
                method: 'POST',
                data: { 
                    reply_id: replyId, 
                    reaction: reactionType,
                    csrf_token: $('meta[name="csrf-token"]').attr('content')
                },
                success: function(data) {
                    if (data.success) {
                        const $reactions = $button.closest('.reactions');
                        $reactions.find('.reaction-btn span').text(0);
                        Object.keys(data.counts).forEach(type => {
                            $reactions.find(`[data-reaction="${type}"] span`).text(data.counts[type] || 0);
                        });
                        updateReactionIconStates($reactions, data.user_reaction);
                        
                        // Trigger notification check for the reply owner
                        if (window.triggerNotificationCheck) {
                            window.triggerNotificationCheck();
                        }
                    } else {
                        $button.after(`<div class="error-message">Error: ${data.error}</div>`);
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                },
                error: function(xhr, status, error) {
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
                    data: { 
                        post_id: postId,
                        csrf_token: $('meta[name="csrf-token"]').attr('content')
                    },
                    success: function(data) {
                        console.log("Delete post response:", data);
                                                    if (data.success) {
                                $(`[data-post-id="${postId}"]`).remove();
                            } else {
                            $postContainer.after(`<div class="error-message">Error: ${data.error}</div>`);
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    },
                    error: function(xhr, status, error) {
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
                    data: { 
                        reply_id: replyId,
                        csrf_token: $('meta[name="csrf-token"]').attr('content')
                    },
                    success: function(data) {
                        console.log("Delete reply response:", data);
                                                    if (data.success) {
                                $(`[data-reply-id="${replyId}"]`).remove();
                            } else {
                            $postContainer.after(`<div class="error-message">Error: ${data.error}</div>`);
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    },
                    error: function(xhr, status, error) {
                        console.error("Delete reply error:", { status, error, response: xhr.responseText });
                        $postContainer.after('<div class="error-message">Error deleting reply. Please try again.</div>');
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                });
            }
        });

        // Modal functionality
        const modal = document.getElementById('postModal');
        const modalContent = document.getElementById('modalPostContent');
        const closeBtn = document.querySelector('.close');

        // Close modal when clicking the X
        closeBtn.onclick = function() {
            modal.style.display = "none";
        }

        // Close modal when clicking outside of it
        window.onclick = function(event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        }

        // Handle post clicks to open modal
        $postContainer.on('click', '.clickable-post', function(e) {
            // Don't open modal if clicking on navigation buttons, community buttons, or other interactive elements
            if ($(e.target).closest('.community-btn, .edit-community-btn, .delete-community-btn, .go-back-btn, .sleek-btn, .action-btn, .reaction-btn, .delete-post, .reply-form, .reply-btn, .reply-input, .menu-btn, .dropdown-content a').length) {
                return;
            }
            
            // Add show class for animation
            setTimeout(() => {
                $('#postModal').addClass('show');
            }, 10);
            
            // Don't open modal if clicking on buttons or forms
            if ($(e.target).closest('.reaction-btn, .delete-post, .reply-form, .reply-btn, .reply-input').length) {
                return;
            }

            const postId = $(this).data('post-id');
            const $post = $(this);
            
            // Show modal immediately with basic post info
            const $postImage = $post.find('.post-image');
            const postImageHtml = $postImage.length ? 
                `<div class="post-image">${$postImage.html()}</div>` : '';
            
            // Temporarily disable CSRF token handling
            // const csrfToken = $('meta[name="csrf-token"]').attr('content');
            // console.log('CSRF Token for modal:', csrfToken);
            
            const basicPostHtml = `
                <div class="post" data-post-id="${postId}">
                    <div class="post-header">
                        <strong>@${$post.find('.post-header strong').text().replace('@', '')}</strong>
                        <span class="timestamp">${$post.find('.timestamp').text()}</span>
                    </div>
                    <p>${$post.find('p').text()}</p>
                    ${postImageHtml}
                    <div class="post-actions">
                        <div class="reactions">
                            <button class="reaction-btn heart" data-reaction="heart" aria-label="Like post">
                                <i class="far fa-heart"></i> <span>${$post.find('.reaction-btn[data-reaction="heart"] span').text()}</span>
                            </button>
                            <button class="reaction-btn thumbs-up" data-reaction="thumbs-up" aria-label="Thumbs up">
                                <i class="far fa-thumbs-up"></i> <span>${$post.find('.reaction-btn[data-reaction="thumbs-up"] span').text()}</span>
                            </button>
                            <button class="reaction-btn thumbs-down" data-reaction="thumbs-down" aria-label="Thumbs down">
                                <i class="far fa-thumbs-down"></i> <span>${$post.find('.reaction-btn[data-reaction="thumbs-down"] span').text()}</span>
                            </button>
                        </div>

                    </div>
                </div>
                <div class="replies">
                </div>
                <form class="reply-form" action="/post_reply" method="POST" enctype="multipart/form-data">
                    <!-- <input type="hidden" name="csrf_token" value="${csrfToken}"> -->
                    <input type="hidden" name="post_id" value="${postId}">
                    <input type="text" name="content" class="reply-input" placeholder="Write a reply...">
                    <div class="reply-form-actions">
                        <div class="file-upload-container">
                            <label for="modal-reply-image-upload" class="file-upload-btn">
                                <i class="fas fa-paperclip"></i>
                            </label>
                            <input type="file" id="modal-reply-image-upload" name="image" accept="image/*" style="display: none;">
                            <span id="modal-reply-selected-file-name" class="selected-file-name"></span>
                        </div>
                        <button type="submit" class="reply-btn"><i class="far fa-paper-plane"></i> Reply</button>
                    </div>
                </form>
            `;
            modalContent.innerHTML = basicPostHtml;
            modal.style.display = "block";
            attachModalEventHandlers();

            // Fetch full post data from server and update
            $.ajax({
                url: '/get_post',
                method: 'GET',
                data: { post_id: postId },
                success: function(data) {
                    if (data.success) {
                        const modalHtml = buildModalContent(data.post);
                        modalContent.innerHTML = modalHtml;
                        attachModalEventHandlers();
                    } else {
                        // Keep the basic post but show error for replies
                        const $replies = $('#modalPostContent .replies');
                        $replies.html('<div style="text-align: center; padding: 20px; color: #ff6f61;">Error loading replies: ' + data.error + '</div>');
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Error fetching post:", { status, error, response: xhr.responseText });
                    // Keep the basic post but show error for replies
                    const $replies = $('#modalPostContent .replies');
                    $replies.html('<div style="text-align: center; padding: 20px; color: #ff6f61;">Error loading replies. Please try again.</div>');
                }
            });
        });

        function buildModalContent(postData) {
            const repliesHtml = postData.replies.map(reply => {
                const replyImageHtml = (reply.image_path && reply.image_path !== 'None' && reply.image_path !== '') ? 
                    `<div class="reply-image"><img src="/uploads/${reply.image_path.replace('uploads/', '')}" alt="Reply image" loading="lazy" onerror="handleImageError(this)" onload="console.log('Reply image loaded successfully:', this.src);"></div>` : '';
                
                console.log("Building reply HTML for:", reply.username, "Current user:", sessionStorage.getItem('username'));
                console.log("Should show delete button:", reply.username === sessionStorage.getItem('username'));
                
                return `
                    <div class="reply" data-reply-id="${reply.id}">
                        <div class="reply-header">
                            <strong>@${reply.username}</strong>
                            <span class="timestamp">${reply.timestamp}</span>
                        </div>
                        <p>${reply.content}</p>
                        ${replyImageHtml}
                        <div class="reply-actions">
                            <div class="reactions">
                                <button class="reaction-btn heart ${reply.user_reaction === 'heart' ? 'active' : ''}" data-reaction="heart" aria-label="Like reply">
                                    <i class="${reply.user_reaction === 'heart' ? 'fas' : 'far'} fa-heart"></i> <span>${reply.reactions.heart || 0}</span>
                                </button>
                                <button class="reaction-btn thumbs-up ${reply.user_reaction === 'thumbs-up' ? 'active' : ''}" data-reaction="thumbs-up" aria-label="Thumbs up reply">
                                    <i class="${reply.user_reaction === 'thumbs-up' ? 'fas' : 'far'} fa-thumbs-up"></i> <span>${reply.reactions['thumbs-up'] || 0}</span>
                                </button>
                                <button class="reaction-btn thumbs-down ${reply.user_reaction === 'thumbs-down' ? 'active' : ''}" data-reaction="thumbs-down" aria-label="Thumbs down reply">
                                    <i class="${reply.user_reaction === 'thumbs-down' ? 'fas' : 'far'} fa-thumbs-down"></i> <span>${reply.reactions['thumbs-down'] || 0}</span>
                                </button>
                            </div>
                            ${reply.username === sessionStorage.getItem('username') ? 
                                `<button class="delete-reply inline-action modal-delete-btn" data-reply-id="${reply.id}" data-action="delete" title="Delete"><i class="far fa-trash-alt"></i></button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            const imageHtml = (postData.image_path && postData.image_path !== 'None' && postData.image_path !== '') ? 
                `<div class="post-image"><img src="/uploads/${postData.image_path.replace('uploads/', '')}" alt="Post image" loading="lazy" onerror="handleImageError(this)" onload="console.log('Modal image loaded successfully:', this.src);" style="display: block;"></div>` : '';
            
            return `
                <div class="post" data-post-id="${postData.id}">
                    <div class="post-header">
                        <strong>@${postData.username}</strong>
                        <span class="timestamp">${postData.timestamp}</span>
                    </div>
                    <p>${postData.content}</p>
                    ${imageHtml}
                    <div class="post-actions">
                        <div class="reactions">
                            <button class="reaction-btn heart ${postData.user_reaction === 'heart' ? 'active' : ''}" data-reaction="heart" aria-label="Like post">
                                <i class="${postData.user_reaction === 'heart' ? 'fas' : 'far'} fa-heart"></i> <span>${postData.reactions.heart || 0}</span>
                            </button>
                            <button class="reaction-btn thumbs-up ${postData.user_reaction === 'thumbs-up' ? 'active' : ''}" data-reaction="thumbs-up" aria-label="Thumbs up">
                                <i class="${postData.user_reaction === 'thumbs-up' ? 'fas' : 'far'} fa-thumbs-up"></i> <span>${postData.reactions['thumbs-up'] || 0}</span>
                            </button>
                            <button class="reaction-btn thumbs-down ${postData.user_reaction === 'thumbs-down' ? 'active' : ''}" data-reaction="thumbs-down" aria-label="Thumbs down">
                                <i class="${postData.user_reaction === 'thumbs-down' ? 'fas' : 'far'} fa-thumbs-down"></i> <span>${postData.reactions['thumbs-down'] || 0}</span>
                            </button>
                        </div>

                    </div>
                </div>
                <div class="replies">
                    ${repliesHtml}
                </div>
                <form class="reply-form" action="/post_reply" method="POST" enctype="multipart/form-data">
                    <input type="hidden" name="csrf_token" value="${$('meta[name="csrf-token"]').attr('content')}">
                    <input type="hidden" name="post_id" value="${postData.id}">
                    <input type="text" name="content" class="reply-input" placeholder="Write a reply..." required>
                    <div class="reply-form-actions">
                        <div class="file-upload-container">
                            <label for="modal-reply-image-upload" class="file-upload-btn">
                                <i class="fas fa-paperclip"></i>
                            </label>
                            <input type="file" id="modal-reply-image-upload" name="image" accept="image/*" style="display: none;">
                            <span id="modal-reply-selected-file-name" class="selected-file-name"></span>
                        </div>
                        <button type="submit" class="reply-btn"><i class="far fa-paper-plane"></i> Reply</button>
                    </div>
                </form>
            `;
        }

        function attachModalEventHandlers() {
            // Remove ALL existing event handlers first
            $(document).off('click', '#modalPostContent .modal-delete-btn');
            $(document).off('click', '#modalPostContent .reactions .reaction-btn');
            
            // Handle delete reply in modal with document-level delegation
            $(document).on('click', '#modalPostContent .modal-delete-btn', function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log("=== DELETE BUTTON CLICKED ===");
                console.log("Target element:", e.target);
                console.log("Current element:", this);
                console.log("Element classes:", $(this).attr('class'));
                const replyId = $(this).data('reply-id');
                console.log("Reply ID:", replyId);
                
                if (confirm('Are you sure you want to delete this reply?')) {
                    console.log("Deleting reply from modal:", replyId);
                    $.ajax({
                        url: '/delete_reply',
                        method: 'POST',
                        data: { 
                            reply_id: replyId,
                            csrf_token: $('meta[name="csrf-token"]').attr('content')
                        },
                        success: function(data) {
                            console.log("Delete reply response:", data);
                            if (data.success) {
                                $(`[data-reply-id="${replyId}"]`).remove();
                                
                                // Update reply count in main feed
                                const postId = $('#modalPostContent .post').data('post-id');
                                const $mainPost = $(`.post[data-post-id="${postId}"]`);
                                if ($mainPost.length) {
                                    const currentCount = parseInt($mainPost.find('.reply-indicator').text().match(/\d+/)[0]) || 0;
                                    const newCount = Math.max(0, currentCount - 1);
                                    $mainPost.find('.reply-indicator').html(`<i class="far fa-comment"></i> ${newCount} replies`);
                                }
                            } else {
                                $('#modalPostContent').after(`<div class="error-message">Error: ${data.error}</div>`);
                                setTimeout(() => $('.error-message').remove(), 3000);
                            }
                        },
                        error: function(xhr, status, error) {
                            console.error("Delete reply error:", { status, error, response: xhr.responseText });
                            $('#modalPostContent').after('<div class="error-message">Error deleting reply. Please try again.</div>');
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    });
                }
            });

            // Re-attach reaction handlers for modal content - ONLY for actual reaction buttons
            $(document).on('click', '#modalPostContent .reactions .reaction-btn', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const $button = $(this);
                
                // Double-check this is actually a reaction button
                if (!$button.hasClass('reaction-btn') || $button.hasClass('modal-delete-btn')) {
                    console.log("=== NOT A REACTION BUTTON - IGNORING ===");
                    return;
                }
                
                console.log("=== REACTION BUTTON CLICKED ===");
                console.log("Target element:", e.target);
                console.log("Current element:", this);
                console.log("Element classes:", $(this).attr('class'));
                
                const reactionType = $button.data('reaction');
                const $post = $button.closest('.post');
                const postId = $post.data('post-id');
                const $reply = $button.closest('.reply');
                
                if ($reply.length) {
                    // This is a reply reaction
                    const replyId = $reply.data('reply-id');
                    console.log("Reaction clicked (modal reply):", { replyId, reactionType });
                    $.ajax({
                        url: '/add_reply_reaction',
                        method: 'POST',
                        data: { 
                            reply_id: replyId, 
                            reaction: reactionType,
                            csrf_token: $('meta[name="csrf-token"]').attr('content')
                        },
                        success: function(data) {
                            if (data.success) {
                                const $reactions = $button.closest('.reactions');
                                $reactions.find('.reaction-btn span').text(0);
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
                            $button.after('<div class="error-message">Error adding reaction. Please try again.</div>');
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    });
                } else {
                    // This is a post reaction
                    console.log("Reaction clicked (modal post):", { postId, reactionType });
                    $.ajax({
                        url: '/add_reaction',
                        method: 'POST',
                        data: { 
                            post_id: postId, 
                            reaction: reactionType,
                            csrf_token: $('meta[name="csrf-token"]').attr('content')
                        },
                        success: function(data) {
                            if (data.success) {
                                const $reactions = $button.closest('.reactions');
                                $reactions.find('.reaction-btn span').text(0);
                                Object.keys(data.counts).forEach(type => {
                                    $reactions.find(`[data-reaction="${type}"] span`).text(data.counts[type] || 0);
                                });
                                updateReactionIconStates($reactions, data.user_reaction);
                                
                                // Update the main feed post as well
                                const $mainPost = $(`.post[data-post-id="${postId}"]`);
                                if ($mainPost.length) {
                                    $mainPost.find('.reaction-btn span').text(0);
                                    Object.keys(data.counts).forEach(type => {
                                        $mainPost.find(`[data-reaction="${type}"] span`).text(data.counts[type] || 0);
                                    });
                                    updateReactionIconStates($mainPost.find('.reactions'), data.user_reaction);
                                }
                            } else {
                                $button.after(`<div class="error-message">Error: ${data.error}</div>`);
                                setTimeout(() => $('.error-message').remove(), 3000);
                            }
                        },
                        error: function(xhr, status, error) {
                            $button.after('<div class="error-message">Error adding reaction. Please try again.</div>');
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    });
                }
            });

            // Handle modal reply file upload
            $('#modalPostContent').off('change', '#modal-reply-image-upload').on('change', '#modal-reply-image-upload', function() {
                const file = this.files[0];
                if (file) {
                    $('#modal-reply-selected-file-name').text(file.name);
                    
                    // Show image preview for reply
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        let previewHtml = $('#modal-reply-image-preview');
                        if (previewHtml.length === 0) {
                            previewHtml = $('<div id="modal-reply-image-preview" class="image-preview"></div>');
                            $('#modal-reply-image-upload').after(previewHtml);
                        }
                        previewHtml.html(`
                            <div class="preview-container">
                                <img src="${e.target.result}" alt="Preview" style="max-width: 150px; max-height: 150px; border-radius: 6px;">
                                <button type="button" class="remove-reply-image" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer;">×</button>
                            </div>
                        `);
                    };
                    reader.readAsDataURL(file);
                } else {
                    $('#modal-reply-selected-file-name').text('');
                    $('#modal-reply-image-preview').remove();
                }
            });

            // Handle remove reply image preview
            $('#modalPostContent').off('click', '.remove-reply-image').on('click', '.remove-reply-image', function() {
                $('#modal-reply-image-upload').val('');
                $('#modal-reply-selected-file-name').text('');
                $('#modal-reply-image-preview').remove();
            });

            // Handle reply submission in modal
            $('#modalPostContent').off('submit', '.reply-form').on('submit', '.reply-form', function(e) {
                e.preventDefault();
                const $form = $(this);
                const postId = $form.find('input[name="post_id"]').val();
                const content = $form.find('textarea[name="content"], input[name="content"]').val().trim();
                const imageFile = $('#modal-reply-image-upload')[0].files[0];
                
                if (!content && !imageFile) {
                    $form.after('<div class="error-message">Reply content or image is required!</div>');
                    setTimeout(() => $('.error-message').remove(), 3000);
                    return;
                }

                const formData = new FormData();
                formData.append('post_id', postId);
                formData.append('content', content);
                
                // Temporarily disable CSRF token handling
                // const metaToken = $('meta[name="csrf-token"]').attr('content');
                // const inputToken = $('input[name="csrf_token"]').val();
                // const csrfToken = metaToken || inputToken;
                // console.log('CSRF Token debugging:', {
                //     metaToken: metaToken,
                //     inputToken: inputToken,
                //     finalToken: csrfToken,
                //     metaElement: $('meta[name="csrf-token"]').length,
                //     inputElement: $('input[name="csrf_token"]').length
                // });
                // formData.append('csrf_token', csrfToken);
                
                if (imageFile) {
                    formData.append('image', imageFile);
                }

                // Debug form data
                console.log('Form data contents:');
                for (let [key, value] of formData.entries()) {
                    console.log(`${key}: ${value}`);
                }

                console.log("Submitting reply in modal:", { postId, content });
                $.ajax({
                    url: '/post_reply',
                    method: 'POST',
                    data: formData,
                    processData: false,
                    contentType: false,
                    success: function(data) {
                        console.log("Reply submission response:", data);
                        if (data.success) {
                            const replyImageHtml = data.reply.image_path ? 
                                `<div class="reply-image"><img src="/static/${data.reply.image_path}" alt="Reply image" loading="lazy"></div>` : '';
                            
                            const replyHtml = `
                                <div class="reply" data-reply-id="${data.reply.id}">
                                    <div class="reply-header">
                                        <strong>@${data.reply.username}</strong>
                                        <span class="timestamp">${data.reply.timestamp}</span>
                                    </div>
                                    <p>${data.reply.content}</p>
                                    ${replyImageHtml}
                                    <div class="reply-actions">
                                        <div class="reactions">
                                            <button class="reaction-btn heart" data-reaction="heart" aria-label="Like reply">
                                                <i class="far fa-heart"></i> <span>0</span>
                                            </button>
                                            <button class="reaction-btn thumbs-up" data-reaction="thumbs-up" aria-label="Thumbs up reply">
                                                <i class="far fa-thumbs-up"></i> <span>0</span>
                                            </button>
                                            <button class="reaction-btn thumbs-down" data-reaction="thumbs-down" aria-label="Thumbs down reply">
                                                <i class="far fa-thumbs-down"></i> <span>0</span>
                                            </button>
                                        </div>
                                        ${data.reply.username === sessionStorage.getItem('username') ? 
                                            `<button class="delete-reply inline-action" data-reply-id="${data.reply.id}" title="Delete"><i class="far fa-trash-alt"></i></button>` : ''}
                                    </div>
                                </div>`;
                            $('#modalPostContent .replies').append(replyHtml);
                            $form.find('textarea[name="content"], input[name="content"]').val('');
                            $('#modal-reply-image-upload').val('');
                            $('#modal-reply-selected-file-name').text('');
                            $('#modal-reply-image-preview').remove();
                            
                            // Update reply count in main feed
                            const $mainPost = $(`.post[data-post-id="${postId}"]`);
                            if ($mainPost.length) {
                                const currentCount = parseInt($mainPost.find('.reply-indicator').text().match(/\d+/)[0]) || 0;
                                $mainPost.find('.reply-indicator').html(`<i class="far fa-comment"></i> ${currentCount + 1} replies`);
                            }
                            
                            // Trigger notification check for the post owner
                            if (window.triggerNotificationCheck) {
                                window.triggerNotificationCheck();
                            }
                        } else {
                            $form.after(`<div class="error-message">Error: ${data.error}</div>`);
                            setTimeout(() => $('.error-message').remove(), 3000);
                        }
                    },
                    error: function(xhr, status, error) {
                        console.error("Reply submission error:", { status, error, response: xhr.responseText });
                        $form.after('<div class="error-message">Error posting reply. Please try again.</div>');
                        setTimeout(() => $('.error-message').remove(), 3000);
                    }
                });
            });
        }
    }
});

// Mobile-specific improvements
(function() {
    'use strict';
    
    // Check if device is mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    
    // Mobile menu improvements
    if (isMobile) {
        // Prevent body scroll when menu is open on mobile
        const $menuBtn = $('.menu-btn');
        const $dropdown = $('.dropdown-content');
        const $body = $('body');
        
        $menuBtn.on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if ($dropdown.is(':visible')) {
                $dropdown.slideUp(200);
                $body.removeClass('menu-open');
            } else {
                $dropdown.slideDown(200);
                $body.addClass('menu-open');
            }
        });
        
        // Close menu when clicking outside
        $(document).on('click', function(e) {
            const $target = $(e.target);
            if (!$target.closest('.sidebar').length && $dropdown.is(':visible')) {
                $dropdown.slideUp(200);
                $body.removeClass('menu-open');
            }
        });
        
        // Close menu on escape key
        $(document).on('keydown', function(e) {
            if (e.key === 'Escape' && $dropdown.is(':visible')) {
                $dropdown.slideUp(200);
                $body.removeClass('menu-open');
            }
        });
        
        // Add touch feedback to buttons
        $('.sleek-btn, .menu-btn, .dropdown-content a').on('touchstart', function() {
            $(this).addClass('touch-active');
        }).on('touchend touchcancel', function() {
            $(this).removeClass('touch-active');
        });
        
        // Improve form interactions on mobile
        $('input, select, textarea').on('focus', function() {
            // Scroll to input on focus to prevent keyboard covering it
            setTimeout(() => {
                $(this).get(0).scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
        
        // Prevent zoom on input focus (iOS)
        $('input, select, textarea').on('focus', function() {
            if (this.type !== 'file') {
                $(this).css('font-size', '16px');
            }
        });
        
        // Optimize modal interactions
        $('.modal, .popup').on('show.bs.modal', function() {
            $body.addClass('modal-open');
        }).on('hidden.bs.modal', function() {
            $body.removeClass('modal-open');
        });
        
        // Improve chat scrolling
        const $chatMessages = $('.chat-messages');
        if ($chatMessages.length) {
            // Auto-scroll to bottom on new messages
            const scrollToBottom = () => {
                $chatMessages.scrollTop($chatMessages[0].scrollHeight);
            };
            
            // Scroll to bottom initially
            setTimeout(scrollToBottom, 100);
            
            // Observe for new messages
            const observer = new MutationObserver(scrollToBottom);
            observer.observe($chatMessages[0], { childList: true, subtree: true });
        }
        
        // Improve user selection panel on mobile
        const $userSelectionPanel = $('.user-selection-panel');
        const $mobileMenuBtn = $('.mobile-menu-btn');
        
        if ($userSelectionPanel.length && $mobileMenuBtn.length) {
            $mobileMenuBtn.on('click', function(e) {
                e.preventDefault();
                $userSelectionPanel.toggleClass('show');
            });
            
            // Close panel when clicking outside
            $(document).on('click', function(e) {
                const $target = $(e.target);
                if (!$target.closest('.user-selection-panel').length && 
                    !$target.closest('.mobile-menu-btn').length && 
                    $userSelectionPanel.hasClass('show')) {
                    $userSelectionPanel.removeClass('show');
                }
            });
        }
        
        // Improve tab navigation on mobile
        $('.tab-btn').on('click', function() {
            const $this = $(this);
            const target = $this.data('target');
            
            // Remove active class from all tabs
            $('.tab-btn').removeClass('active');
            $('.tab-content').removeClass('active');
            
            // Add active class to clicked tab
            $this.addClass('active');
            $('#' + target).addClass('active');
        });
        
        // Add pull-to-refresh functionality for feeds
        let startY = 0;
        let currentY = 0;
        let pullDistance = 0;
        const pullThreshold = 80;
        
        $('.posts, .feed-content').on('touchstart', function(e) {
            if ($(this).scrollTop() === 0) {
                startY = e.originalEvent.touches[0].clientY;
            }
        }).on('touchmove', function(e) {
            if ($(this).scrollTop() === 0) {
                currentY = e.originalEvent.touches[0].clientY;
                pullDistance = currentY - startY;
                
                if (pullDistance > 0 && pullDistance < pullThreshold) {
                    e.preventDefault();
                    $(this).css('transform', `translateY(${pullDistance}px)`);
                }
            }
        }).on('touchend', function(e) {
            if (pullDistance > pullThreshold) {
                // Trigger refresh
                location.reload();
            } else {
                $(this).css('transform', 'translateY(0)');
            }
            pullDistance = 0;
        });
        
        // Improve image loading on mobile
        $('img').on('load', function() {
            $(this).addClass('loaded');
        }).on('error', function() {
            $(this).addClass('error');
        });
        
        // Add loading states for better UX
        $('form').on('submit', function() {
            const $submitBtn = $(this).find('button[type="submit"]');
            if ($submitBtn.length) {
                $submitBtn.prop('disabled', true).text('Loading...');
            }
        });
        
        // Improve accessibility on mobile
        $('button, a').on('focus', function() {
            $(this).addClass('focus-visible');
        }).on('blur', function() {
            $(this).removeClass('focus-visible');
        });
        
        // Add haptic feedback for important actions (if supported)
        if ('vibrate' in navigator) {
            $('.sleek-btn, .menu-btn').on('click', function() {
                navigator.vibrate(50);
            });
        }
        
        // Optimize performance on mobile
        let resizeTimeout;
        $(window).on('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                // Recalculate layouts after resize
                $('.container').each(function() {
                    $(this).css('min-height', `calc(100vh - ${$('.sidebar').outerHeight()}px)`);
                });
            }, 250);
        });
        
        // Improve keyboard navigation
        $(document).on('keydown', function(e) {
            // Tab navigation improvements
            if (e.key === 'Tab') {
                $('body').addClass('keyboard-navigation');
            }
        });
        
        $(document).on('mousedown touchstart', function() {
            $('body').removeClass('keyboard-navigation');
        });
        
        // Add CSS classes for mobile-specific styling
        $('body').addClass('mobile-device');
        
        // Handle orientation changes
        window.addEventListener('orientationchange', function() {
            setTimeout(function() {
                // Recalculate viewport heights
                const vh = window.innerHeight * 0.01;
                document.documentElement.style.setProperty('--vh', `${vh}px`);
                
                // Recalculate container heights
                $('.container, .chat-container, .messages-container').each(function() {
                    const sidebarHeight = $('.sidebar').outerHeight();
                    $(this).css('height', `calc(100vh - ${sidebarHeight}px)`);
                });
            }, 100);
        });
        
        // Initialize viewport height variable
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    
    // Desktop-specific improvements
    if (!isMobile) {
        // Hover effects for desktop
        $('.sleek-btn, .menu-btn').on('mouseenter', function() {
            $(this).addClass('hover');
        }).on('mouseleave', function() {
            $(this).removeClass('hover');
        });
        
        // Desktop menu hover behavior
        $('.sidebar').on('mouseenter', function() {
            $('.dropdown-content').slideDown(200);
        }).on('mouseleave', function() {
            $('.dropdown-content').slideUp(200);
        });
    }
    
    // Universal improvements for all devices
    // Prevent double-tap zoom on buttons
    $('button, a').on('touchend', function(e) {
        e.preventDefault();
        $(this).click();
    });
    
    // Improve form validation feedback
    $('form').on('submit', function(e) {
        const $form = $(this);
        const $inputs = $form.find('input[required], select[required], textarea[required]');
        let isValid = true;
        
        $inputs.each(function() {
            if (!$(this).val().trim()) {
                isValid = false;
                $(this).addClass('error');
            } else {
                $(this).removeClass('error');
            }
        });
        
        if (!isValid) {
            e.preventDefault();
            // Show error message
            if (!$('.form-error').length) {
                $form.prepend('<div class="form-error">Please fill in all required fields.</div>');
            }
        }
    });
    
    // Remove error class on input
    $('input, select, textarea').on('input change', function() {
        $(this).removeClass('error');
        $('.form-error').remove();
    });
    
    // Add loading states
    $(document).on('click', '.sleek-btn', function() {
        const $btn = $(this);
        if (!$btn.prop('disabled')) {
            $btn.addClass('loading');
            setTimeout(() => {
                $btn.removeClass('loading');
            }, 2000);
        }
    });
    
    // Improve accessibility
    $('button, a').attr('tabindex', '0');
    
    // Add keyboard shortcuts
    $(document).on('keydown', function(e) {
        // Ctrl/Cmd + K to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            $('input[type="search"], input[placeholder*="search"]').first().focus();
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            $('.modal, .popup').hide();
            $('.dropdown-content').hide();
        }
    });
    
    console.log('Mobile optimizations loaded. Device type:', isMobile ? 'Mobile' : 'Desktop');
})();

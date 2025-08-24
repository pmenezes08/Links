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
    } else {
        console.error("Menu elements not found:", { $menuBtn, $dropdown });
    }

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
            const content = $(this).find('input[name="content"]').val().trim();
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
                                    ${data.post.username === sessionStorage.getItem('username') ? '<button class="delete-post inline-action" data-post-id="' + data.post.id + '"><i class="far fa-trash-alt"></i> Delete</button>' : ''}
                                </div>
                                <div class="reply-indicator">
                                    <i class="far fa-comment"></i> 0 replies
                                </div>
                            </div>`;
                        $postContainer.prepend(postHtml);
                        $postForm.find('input[name="content"]').val('');
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
            const content = $form.find('input[name="content"]').val().trim();
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
                                    ${data.reply.username === sessionStorage.getItem('username') ? '<button class="delete-reply inline-action" data-reply-id="' + data.reply.id + '"><i class="far fa-trash-alt"></i> Delete</button>' : ''}
                                </div>
                            </div>`;
                        $replies.append(replyHtml);
                        $form.find('input[name="content"]').val('');
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
                        
                        // Show toast notification
                        if (typeof showToast === 'function') {
                            const reactionIcons = {
                                'heart': 'fas fa-heart',
                                'thumbs-up': 'fas fa-thumbs-up', 
                                'thumbs-down': 'fas fa-thumbs-down'
                            };
                            const reactionNames = {
                                'heart': 'liked',
                                'thumbs-up': 'gave thumbs up to',
                                'thumbs-down': 'gave thumbs down to'
                            };
                            
                            if (data.user_reaction) {
                                showToast(
                                    'Reaction Added',
                                    `You ${reactionNames[data.user_reaction]} this post`,
                                    reactionIcons[data.user_reaction],
                                    5000
                                );
                            } else {
                                showToast(
                                    'Reaction Removed',
                                    'Your reaction has been removed',
                                    'fas fa-undo',
                                    3000
                                );
                            }
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
                                `<button class="delete-reply inline-action modal-delete-btn" data-reply-id="${reply.id}" data-action="delete"><i class="far fa-trash-alt"></i> Delete</button>` : ''}
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
                const content = $form.find('input[name="content"]').val().trim();
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
                                            `<button class="delete-reply inline-action" data-reply-id="${data.reply.id}"><i class="far fa-trash-alt"></i> Delete</button>` : ''}
                                    </div>
                                </div>`;
                            $('#modalPostContent .replies').append(replyHtml);
                            $form.find('input[name="content"]').val('');
                            $('#modal-reply-image-upload').val('');
                            $('#modal-reply-selected-file-name').text('');
                            $('#modal-reply-image-preview').remove();
                            
                            // Update reply count in main feed
                            const $mainPost = $(`.post[data-post-id="${postId}"]`);
                            if ($mainPost.length) {
                                const currentCount = parseInt($mainPost.find('.reply-indicator').text().match(/\d+/)[0]) || 0;
                                $mainPost.find('.reply-indicator').html(`<i class="far fa-comment"></i> ${currentCount + 1} replies`);
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

// ===== MOBILE OPTIMIZATION =====

// Mobile-specific enhancements
function initMobileOptimizations() {
    const isMobile = window.innerWidth <= 768;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (isMobile || isTouch) {
        console.log('Mobile optimizations enabled');
        
        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (event) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
        
        // Better touch feedback for buttons
        const touchButtons = document.querySelectorAll('.sleek-btn, .menu-btn, .reaction-btn');
        touchButtons.forEach(button => {
            button.addEventListener('touchstart', function() {
                this.style.transform = 'scale(0.95)';
            });
            
            button.addEventListener('touchend', function() {
                this.style.transform = 'scale(1)';
            });
        });
        
        // Swipe gestures for mobile navigation
        let startX = 0;
        let startY = 0;
        
        document.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', function(e) {
            if (!startX || !startY) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const diffX = startX - endX;
            const diffY = startY - endY;
            
            // Swipe left to right (show menu)
            if (diffX < -50 && Math.abs(diffY) < 50) {
                const menuBtn = document.querySelector('.menu-btn');
                if (menuBtn) {
                    menuBtn.click();
                }
            }
            
            // Swipe right to left (hide menu)
            if (diffX > 50 && Math.abs(diffY) < 50) {
                const dropdown = document.querySelector('.dropdown-content');
                if (dropdown && dropdown.style.display === 'block') {
                    dropdown.style.display = 'none';
                }
            }
            
            startX = 0;
            startY = 0;
        });
        
        // Better modal handling for mobile
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.addEventListener('touchmove', function(e) {
                e.preventDefault();
            }, { passive: false });
        });
        
        // Close modals with swipe down
        modals.forEach(modal => {
            let startY = 0;
            let currentY = 0;
            
            modal.addEventListener('touchstart', function(e) {
                startY = e.touches[0].clientY;
            });
            
            modal.addEventListener('touchmove', function(e) {
                currentY = e.touches[0].clientY;
                const diffY = currentY - startY;
                
                if (diffY > 50) {
                    this.style.transform = `translateY(${diffY}px)`;
                }
            });
            
            modal.addEventListener('touchend', function(e) {
                const diffY = currentY - startY;
                if (diffY > 100) {
                    this.style.display = 'none';
                } else {
                    this.style.transform = 'translateY(0)';
                }
            });
        });
    }
}

// Responsive image handling
function initResponsiveImages() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        img.addEventListener('load', function() {
            this.style.opacity = '1';
        });
        
        // Lazy loading for images
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src && img.dataset.src !== 'undefined') {
                            img.src = img.dataset.src;
                        }
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                });
            });
            
            imageObserver.observe(img);
        }
    });
}

// Better form handling for mobile
function initMobileForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        // Prevent zoom on input focus (iOS)
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', function() {
                if (this.type !== 'file') {
                    this.style.fontSize = '16px';
                }
            });
            
            input.addEventListener('blur', function() {
                if (this.type !== 'file') {
                    this.style.fontSize = '';
                }
            });
        });
        
        // Better form validation for mobile
        form.addEventListener('submit', function(e) {
            const requiredFields = form.querySelectorAll('[required]');
            let isValid = true;
            
            requiredFields.forEach(field => {
                if (!field.value.trim()) {
                    isValid = false;
                    field.style.borderColor = '#ff4444';
                    
                    // Show error message
                    let errorMsg = field.parentNode.querySelector('.error-message');
                    if (!errorMsg) {
                        errorMsg = document.createElement('div');
                        errorMsg.className = 'error-message';
                        errorMsg.style.color = '#ff4444';
                        errorMsg.style.fontSize = '12px';
                        errorMsg.style.marginTop = '5px';
                        field.parentNode.appendChild(errorMsg);
                    }
                    errorMsg.textContent = 'This field is required';
                } else {
                    field.style.borderColor = '';
                    const errorMsg = field.parentNode.querySelector('.error-message');
                    if (errorMsg) {
                        errorMsg.remove();
                    }
                }
            });
            
            if (!isValid) {
                e.preventDefault();
                // Scroll to first error
                const firstError = form.querySelector('[style*="border-color: rgb(255, 68, 68)"]');
                if (firstError) {
                    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    });
}

// Performance optimizations
function initPerformanceOptimizations() {
    // Debounce scroll events
    let scrollTimeout;
    window.addEventListener('scroll', function() {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(function() {
            // Handle scroll-based actions here
        }, 100);
    });
    
    // Optimize animations for mobile
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.body.style.setProperty('--transition-duration', '0.01ms');
    }
    
    // Better memory management
    window.addEventListener('beforeunload', function() {
        // Clean up any intervals or timeouts
        const intervals = window.intervals || [];
        intervals.forEach(clearInterval);
    });
}

// Initialize all mobile optimizations
document.addEventListener('DOMContentLoaded', function() {
    initMobileOptimizations();
    initResponsiveImages();
    initMobileForms();
    initPerformanceOptimizations();
    
    // Handle orientation changes
    window.addEventListener('orientationchange', function() {
        setTimeout(function() {
            // Recalculate layouts after orientation change
            window.dispatchEvent(new Event('resize'));
        }, 100);
    });
    
    // Handle viewport changes
    let viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
        // Ensure proper viewport for mobile
        if (window.innerWidth <= 768) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
    }
});

// Service Worker for offline support (if needed)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('SW registered: ', registration);
            })
            .catch(function(registrationError) {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// ===== ENHANCED FEED & MESSAGING FUNCTIONALITY =====

// Enhanced Feed Interactions
function initEnhancedFeedFeatures() {
    // Auto-resize composer input
    const composerInput = document.querySelector('.composer-input');
    if (composerInput) {
        composerInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        
        // Focus management
        composerInput.addEventListener('focus', function() {
            this.parentElement.parentElement.style.borderColor = '#4db6ac';
        });
        
        composerInput.addEventListener('blur', function() {
            this.parentElement.parentElement.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        });
    }
    
    // Enhanced file upload
    const fileUpload = document.getElementById('image-upload');
    const selectedFileName = document.getElementById('selected-file-name');
    
    if (fileUpload && selectedFileName) {
        fileUpload.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                // Show file name with size
                const fileSize = (file.size / 1024 / 1024).toFixed(2);
                selectedFileName.textContent = `${file.name} (${fileSize}MB)`;
                selectedFileName.style.display = 'block';
                
                // Preview image if it's an image
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        // Create preview
                        let preview = document.querySelector('.image-preview');
                        if (!preview) {
                            preview = document.createElement('div');
                            preview.className = 'image-preview';
                            preview.style.cssText = `
                                margin: 8px 0;
                                border-radius: 8px;
                                overflow: hidden;
                                position: relative;
                            `;
                            fileUpload.parentElement.parentElement.appendChild(preview);
                        }
                        preview.innerHTML = `
                            <img src="${e.target.result}" style="width: 100%; max-height: 200px; object-fit: cover;">
                            <button type="button" class="remove-image" style="
                                position: absolute; top: 8px; right: 8px;
                                background: rgba(0,0,0,0.7); color: white;
                                border: none; border-radius: 50%; width: 24px; height: 24px;
                                cursor: pointer; font-size: 12px;
                            ">×</button>
                        `;
                        
                        // Remove image functionality
                        preview.querySelector('.remove-image').addEventListener('click', function() {
                            fileUpload.value = '';
                            selectedFileName.textContent = '';
                            selectedFileName.style.display = 'none';
                            preview.remove();
                        });
                    };
                    reader.readAsDataURL(file);
                }
            } else {
                selectedFileName.textContent = '';
                selectedFileName.style.display = 'none';
                const preview = document.querySelector('.image-preview');
                if (preview) preview.remove();
            }
        });
    }
    
    // Enhanced post interactions
    const posts = document.querySelectorAll('.post');
    posts.forEach(post => {
        // Double tap to like
        let lastTap = 0;
        post.addEventListener('touchend', function(e) {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            if (tapLength < 500 && tapLength > 0) {
                // Double tap detected
                const heartBtn = this.querySelector('.reaction-btn[data-reaction="heart"]');
                if (heartBtn) {
                    heartBtn.click();
                    // Visual feedback
                    this.style.transform = 'scale(1.05)';
                    setTimeout(() => {
                        this.style.transform = '';
                    }, 200);
                }
                e.preventDefault();
            }
            lastTap = currentTime;
        });
        
        // Long press for options (mobile)
        let pressTimer;
        post.addEventListener('touchstart', function(e) {
            pressTimer = setTimeout(() => {
                showPostOptions(this, e);
            }, 500);
        });
        
        post.addEventListener('touchend', function() {
            clearTimeout(pressTimer);
        });
        
        post.addEventListener('touchmove', function() {
            clearTimeout(pressTimer);
        });
    });
}

// Enhanced Messaging Features
function initEnhancedMessaging() {
    // Auto-resize chat input
    const chatInput = document.querySelector('.chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        
        // Send on Enter (Shift+Enter for new line)
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const sendBtn = document.querySelector('.send-btn');
                if (sendBtn) sendBtn.click();
            }
        });
    }
    
    // Enhanced user selection
    const userItems = document.querySelectorAll('.user-item, .member-item');
    userItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all items
            userItems.forEach(i => i.classList.remove('active'));
            // Add active class to clicked item
            this.classList.add('active');
            
            // Show typing indicator
            showTypingIndicator();
        });
        
        // Hover effects for desktop
        item.addEventListener('mouseenter', function() {
            if (window.innerWidth > 768) {
                this.style.transform = 'translateX(8px)';
            }
        });
        
        item.addEventListener('mouseleave', function() {
            if (window.innerWidth > 768) {
                this.style.transform = 'translateX(0)';
            }
        });
    });
    
    // Mobile menu toggle for messaging
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const userSelectionPanel = document.querySelector('.user-selection-panel');
    
    if (mobileMenuBtn && userSelectionPanel) {
        mobileMenuBtn.addEventListener('click', function() {
            userSelectionPanel.classList.toggle('show');
        });
        
        // Close panel when clicking outside
        document.addEventListener('click', function(e) {
            if (!userSelectionPanel.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                userSelectionPanel.classList.remove('show');
            }
        });
    }
    
    // Tab switching with smooth transitions
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById(targetTab + '-tab').classList.add('active');
            
            // Smooth transition
            const activeContent = document.getElementById(targetTab + '-tab');
            activeContent.style.opacity = '0';
            activeContent.style.transform = 'translateY(10px)';
            
            setTimeout(() => {
                activeContent.style.transition = 'all 0.3s ease';
                activeContent.style.opacity = '1';
                activeContent.style.transform = 'translateY(0)';
            }, 50);
        });
    });
}

// Enhanced Post Options
function showPostOptions(post, event) {
    const options = document.createElement('div');
    options.className = 'post-options';
    options.style.cssText = `
        position: fixed;
        top: ${event.touches ? event.touches[0].clientY : event.clientY}px;
        left: ${event.touches ? event.touches[0].clientX : event.clientX}px;
        background: #2d3839;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 8px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        min-width: 120px;
    `;
    
    const postId = post.getAttribute('data-post-id');
    const username = post.querySelector('.post-header strong').textContent.replace('@', '');
    const currentUser = sessionStorage.getItem('username');
    
    options.innerHTML = `
        <button class="option-btn" data-action="like" style="
            display: block; width: 100%; text-align: left; padding: 8px 12px;
            background: none; border: none; color: white; cursor: pointer;
            border-radius: 4px; font-size: 14px;
        ">❤️ Like</button>
        <button class="option-btn" data-action="reply" style="
            display: block; width: 100%; text-align: left; padding: 8px 12px;
            background: none; border: none; color: white; cursor: pointer;
            border-radius: 4px; font-size: 14px;
        ">💬 Reply</button>
        ${username === currentUser ? `
        <button class="option-btn" data-action="delete" style="
            display: block; width: 100%; text-align: left; padding: 8px 12px;
            background: none; border: none; color: #ff6f61; cursor: pointer;
            border-radius: 4px; font-size: 14px;
        ">🗑️ Delete</button>
        ` : ''}
    `;
    
    document.body.appendChild(options);
    
    // Handle option clicks
    options.addEventListener('click', function(e) {
        const action = e.target.getAttribute('data-action');
        if (action === 'like') {
            const heartBtn = post.querySelector('.reaction-btn[data-reaction="heart"]');
            if (heartBtn) heartBtn.click();
        } else if (action === 'reply') {
            post.click(); // Open post modal
        } else if (action === 'delete') {
            if (confirm('Are you sure you want to delete this post?')) {
                const deleteBtn = post.querySelector('.delete-post');
                if (deleteBtn) deleteBtn.click();
            }
        }
        options.remove();
    });
    
    // Remove options when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function removeOptions() {
            options.remove();
            document.removeEventListener('click', removeOptions);
        });
    }, 100);
}

// Typing Indicator
function showTypingIndicator() {
    const chatMessages = document.querySelector('.chat-messages');
    if (!chatMessages) return;
    
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator message received';
    typingIndicator.innerHTML = `
        <div class="message-content" style="background: #2d3839; padding: 8px 12px; border-radius: 18px;">
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    
    // Add typing indicator styles
    const style = document.createElement('style');
    style.textContent = `
        .typing-dots {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        .typing-dots span {
            width: 6px;
            height: 6px;
            background: #9fb0b5;
            border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
        .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Remove after 3 seconds
    setTimeout(() => {
        typingIndicator.remove();
    }, 3000);
}

// Enhanced Scroll Behavior
function initEnhancedScroll() {
    // Smooth scroll to top for feeds
    const feedContainer = document.querySelector('.feed');
    if (feedContainer) {
        let scrollTimeout;
        feedContainer.addEventListener('scroll', function() {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                // Show/hide scroll to top button
                const scrollTop = this.scrollTop;
                let scrollBtn = document.querySelector('.scroll-to-top');
                
                if (scrollTop > 300) {
                    if (!scrollBtn) {
                        scrollBtn = document.createElement('button');
                        scrollBtn.className = 'scroll-to-top';
                        scrollBtn.innerHTML = '↑';
                        scrollBtn.style.cssText = `
                            position: fixed; bottom: 20px; right: 20px;
                            width: 50px; height: 50px; border-radius: 50%;
                            background: #4db6ac; color: white; border: none;
                            cursor: pointer; z-index: 1000; font-size: 20px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                            transition: all 0.3s ease;
                        `;
                        document.body.appendChild(scrollBtn);
                        
                        scrollBtn.addEventListener('click', function() {
                            feedContainer.scrollTo({
                                top: 0,
                                behavior: 'smooth'
                            });
                        });
                    }
                    scrollBtn.style.opacity = '1';
                } else if (scrollBtn) {
                    scrollBtn.style.opacity = '0';
                    setTimeout(() => scrollBtn.remove(), 300);
                }
            }, 100);
        });
    }
    
    // Infinite scroll for messages
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
        chatMessages.addEventListener('scroll', function() {
            if (this.scrollTop === 0) {
                // Load more messages when scrolling to top
                loadMoreMessages();
            }
        });
    }
}

// Load More Messages (placeholder)
function loadMoreMessages() {
    // This would typically make an AJAX call to load older messages
    console.log('Loading more messages...');
}

// Enhanced Touch Interactions
function initTouchInteractions() {
    // Swipe to delete posts (mobile)
    let startX = 0;
    let currentX = 0;
    
    document.addEventListener('touchstart', function(e) {
        const post = e.target.closest('.post');
        if (post) {
            startX = e.touches[0].clientX;
            currentX = startX;
        }
    });
    
    document.addEventListener('touchmove', function(e) {
        const post = e.target.closest('.post');
        if (post && startX > 0) {
            currentX = e.touches[0].clientX;
            const diffX = currentX - startX;
            
            if (diffX < -50) {
                post.style.transform = `translateX(${diffX}px)`;
                post.style.opacity = Math.max(0.5, 1 + diffX / 200);
            }
        }
    });
    
    document.addEventListener('touchend', function(e) {
        const post = e.target.closest('.post');
        if (post && startX > 0) {
            const diffX = currentX - startX;
            
            if (diffX < -100) {
                // Swipe to delete
                if (confirm('Delete this post?')) {
                    const deleteBtn = post.querySelector('.delete-post');
                    if (deleteBtn) deleteBtn.click();
                } else {
                    post.style.transform = '';
                    post.style.opacity = '';
                }
            } else {
                // Reset position
                post.style.transform = '';
                post.style.opacity = '';
            }
            
            startX = 0;
            currentX = 0;
        }
    });
}

// Initialize all enhanced features
document.addEventListener('DOMContentLoaded', function() {
    initEnhancedFeedFeatures();
    initEnhancedMessaging();
    initEnhancedScroll();
    initTouchInteractions();
    
    // Performance optimization: Lazy load images
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src && img.dataset.src !== 'undefined') {
                        img.src = img.dataset.src;
                    }
                    img.classList.remove('lazy');
                    imageObserver.unobserve(img);
                }
            });
        });
        
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + Enter to submit post
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const composerForm = document.querySelector('.composer-form');
            if (composerForm && document.activeElement.classList.contains('composer-input')) {
                composerForm.submit();
            }
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                if (modal.style.display === 'block') {
                    modal.style.display = 'none';
                }
            });
        }
    });
});

// ===== MOBILE IMAGE LOADING FIXES =====

// Enhanced mobile image loading
function initMobileImageLoading() {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        console.log('Mobile image loading optimizations enabled');
        
        // Handle image loading errors
        const images = document.querySelectorAll('img');
        console.log(`Found ${images.length} images on page`);
        
        images.forEach((img, index) => {
            console.log(`Image ${index + 1}:`, {
                src: img.src,
                alt: img.alt,
                className: img.className,
                parentElement: img.parentElement.className
            });
            
            // Add loading error handler
            img.addEventListener('error', function() {
                console.log('Image failed to load:', this.src);
                console.log('Image element:', this);
                console.log('Parent element:', this.parentElement);
                // Show a placeholder or retry
                this.style.display = 'none';
                this.parentElement.style.background = '#2d3839';
                this.parentElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #9fb0b5;">Image could not be loaded</div>';
            });
            
            // Add loading success handler
            img.addEventListener('load', function() {
                console.log('Image loaded successfully:', this.src);
                this.style.opacity = '1';
                this.style.transition = 'opacity 0.3s ease';
            });
            
            // Set initial opacity for smooth loading
            img.style.opacity = '0';
            
            // Force image loading for mobile
            if (img.dataset.src && img.dataset.src !== 'undefined') {
                img.src = img.dataset.src;
            }
            
            // Log the current src to see what path is being used
            console.log(`Image ${index + 1} current src:`, img.src);
        });
        
        // Retry failed images
        function retryFailedImages() {
            const failedImages = document.querySelectorAll('img[style*="display: none"]');
            console.log(`Retrying ${failedImages.length} failed images`);
            failedImages.forEach(img => {
                const originalSrc = img.src;
                console.log('Retrying image:', originalSrc);
                img.src = '';
                setTimeout(() => {
                    img.src = originalSrc;
                    img.style.display = 'block';
                }, 1000);
            });
        }
        
        // Retry after 3 seconds
        setTimeout(retryFailedImages, 3000);
        
        // Handle orientation changes
        window.addEventListener('orientationchange', function() {
            setTimeout(() => {
                // Reload images after orientation change
                const images = document.querySelectorAll('img');
                images.forEach(img => {
                    const src = img.src;
                    img.src = '';
                    setTimeout(() => {
                        img.src = src;
                    }, 100);
                });
            }, 500);
        });
    }
}

// Enhanced image preloading for mobile
function preloadImages() {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        const images = document.querySelectorAll('img[src]');
        images.forEach(img => {
            // Create a new image object to preload
            const preloadImg = new Image();
            preloadImg.onload = function() {
                // Image preloaded successfully
                console.log('Image preloaded:', img.src);
            };
            preloadImg.onerror = function() {
                console.log('Image preload failed:', img.src);
            };
            preloadImg.src = img.src;
        });
    }
}

// Initialize mobile image loading
document.addEventListener('DOMContentLoaded', function() {
    initMobileImageLoading();
    preloadImages();
    
    // Handle dynamic content (for posts loaded via AJAX)
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                const newImages = mutation.target.querySelectorAll('img');
                if (newImages.length > 0) {
                    initMobileImageLoading();
                }
            }
        });
    });
    
    // Observe the posts container for new images
    const postsContainer = document.querySelector('.posts');
    if (postsContainer) {
        observer.observe(postsContainer, {
            childList: true,
            subtree: true
        });
    }
});

// ===== MOBILE MODAL IMPROVEMENTS =====

// Enhanced modal handling for mobile
function initMobileModalImprovements() {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        console.log('Mobile modal improvements enabled');
        
        // Handle modal opening
        $(document).on('click', '.clickable-post', function(e) {
            // Don't open modal if clicking on navigation buttons, community buttons, or other interactive elements
            if ($(e.target).closest('.community-btn, .edit-community-btn, .delete-community-btn, .go-back-btn, .sleek-btn, .action-btn, .reaction-btn, .delete-post, .reply-form, .reply-btn, .reply-input, .menu-btn, .dropdown-content a').length) {
                return;
            }
            
            // Add show class for animation
            setTimeout(() => {
                $('#postModal').addClass('show');
            }, 10);
            
            // Ensure modal content is properly structured
            const modalContent = document.querySelector('.modal-content');
            const closeBtn = document.querySelector('.modal .close');
            
            if (modalContent && closeBtn) {
                // Ensure close button is positioned correctly within modal
                closeBtn.style.position = 'absolute';
                closeBtn.style.zIndex = '10';
                
                // Add modal header if it doesn't exist
                if (!document.querySelector('.modal-header')) {
                    const header = document.createElement('div');
                    header.className = 'modal-header';
                    header.innerHTML = '<h2>Post Details</h2>';
                    modalContent.insertBefore(header, modalContent.firstChild);
                }
                
                // Ensure modal body exists
                if (!document.querySelector('.modal-body')) {
                    const body = document.createElement('div');
                    body.className = 'modal-body';
                    
                    // Move all content except header to body
                    const content = Array.from(modalContent.children);
                    content.forEach(child => {
                        if (!child.classList.contains('modal-header') && !child.classList.contains('close')) {
                            body.appendChild(child);
                        }
                    });
                    
                    modalContent.appendChild(body);
                }
            }
        });
        
        // Handle modal closing
        $(document).on('click', '.modal .close', function() {
            $('#postModal').removeClass('show');
            setTimeout(() => {
                $('#postModal').hide();
            }, 300);
        });
        
        // Close modal when clicking outside
        $(document).on('click', '.modal', function(e) {
            if (e.target === this) {
                $('#postModal').removeClass('show');
                setTimeout(() => {
                    $('#postModal').hide();
                }, 300);
            }
        });
        
        // Close modal on escape key
        $(document).on('keydown', function(e) {
            if (e.key === 'Escape' && $('#postModal').is(':visible')) {
                $('#postModal').removeClass('show');
                setTimeout(() => {
                    $('#postModal').hide();
                }, 300);
            }
        });
        
        // Handle orientation changes
        window.addEventListener('orientationchange', function() {
            setTimeout(() => {
                // Recalculate modal position and size
                const modal = document.querySelector('.modal');
                const modalContent = document.querySelector('.modal-content');
                const modalBody = document.querySelector('.modal-body');
                
                if (modal && modalContent && modalBody) {
                    // Ensure modal content fits in viewport
                    const viewportHeight = window.innerHeight;
                    const headerHeight = 60; // Approximate header height
                    const maxBodyHeight = viewportHeight - headerHeight - 20; // 20px for padding
                    
                    modalBody.style.maxHeight = maxBodyHeight + 'px';
                }
            }, 500);
        });
        
        // Handle window resize
        window.addEventListener('resize', function() {
            if ($('#postModal').is(':visible')) {
                const modalBody = document.querySelector('.modal-body');
                const viewportHeight = window.innerHeight;
                const headerHeight = 60;
                const maxBodyHeight = viewportHeight - headerHeight - 20;
                
                if (modalBody) {
                    modalBody.style.maxHeight = maxBodyHeight + 'px';
                }
            }
        });
    }
}

// Initialize mobile modal improvements
document.addEventListener('DOMContentLoaded', function() {
    initMobileModalImprovements();
});

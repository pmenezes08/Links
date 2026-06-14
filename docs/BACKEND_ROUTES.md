# Backend HTTP routes inventory

Auto-generated structure; **purpose** is inferred from URL/handler name. **Client usage** is a best-effort grep
in `client/src` and `admin-web/src` for the exact path string (may miss dynamic builds).

For **monolith** routes, many legacy HTML + JSON surfaces coexist — prefer new work in `backend/blueprints/`.

## Blueprints (`backend/blueprints/*.py`)

| Path | Method(s) | Handler | Source file | Purpose (short) | Where used (TS/TSX hits) |
|------|-----------|---------|-------------|-----------------|---------------------------|
| `/api/about/tutorial_videos` | GET | `get_tutorial_videos` | `backend/blueprints/about_tutorials.py:36` | get tutorial videos | `client/src/pages/AboutCPoint.tsx` (1) |
| `/api/admin/about/tutorial_video` | POST | `admin_set_tutorial_video` | `backend/blueprints/about_tutorials.py:48` | admin set tutorial video | `client/src/pages/AboutCPoint.tsx` (1) |
| `/api/admin/about/tutorial_upload_url` | POST | `admin_tutorial_upload_url` | `backend/blueprints/about_tutorials.py:89` | admin tutorial upload url | `client/src/pages/AboutCPoint.tsx` (1) |
| `/api/admin/communities/directory` | GET | `api_admin_communities_directory` | `backend/blueprints/admin_communities.py:94` | api admin communities directory | `admin-web/src/pages/CommunitiesDirectory.tsx` (1) |
| `/api/admin/backfill_steve_chat_memory` | POST | `admin_backfill_steve_chat_memory` | `backend/blueprints/admin_memory.py:20` | admin backfill steve chat memory | *(no exact string match — may use helpers)* |
| `/api/admin/backfill_steve_chat_memory/status` | GET | `admin_backfill_status` | `backend/blueprints/admin_memory.py:69` | admin backfill status | *(no exact string match — may use helpers)* |
| `/api/admin/subscriptions/users` | GET | `api_admin_subscription_users` | `backend/blueprints/admin_subscriptions.py:38` | api admin subscription users | `admin-web/src/pages/Subscriptions.tsx` (1) |
| `/api/admin/subscriptions/communities` | GET | `api_admin_subscription_communities` | `backend/blueprints/admin_subscriptions.py:78` | api admin subscription communities | `admin-web/src/pages/Subscriptions.tsx` (1) |
| `/api/admin/subscriptions/pricing_diagnostics` | GET | `api_admin_subscription_pricing_diagnostics` | `backend/blueprints/admin_subscriptions.py:106` | api admin subscription pricing diagnostics | `admin-web/src/pages/CommunitiesDirectory.tsx` (1), `admin-web/src/pages/Subscriptions.tsx` (1) |
| `/api/admin/users/<string:target_username>/special/grant` | POST | `grant_special` | `backend/blueprints/admin_users.py:54` | grant special | *(no exact string match — may use helpers)* |
| `/api/admin/users/<string:target_username>/special/revoke` | POST | `revoke_special` | `backend/blueprints/admin_users.py:81` | revoke special | *(no exact string match — may use helpers)* |
| `/api/admin/users/<string:target_username>/trial/revoke` | POST | `revoke_trial` | `backend/blueprints/admin_users.py:108` | revoke trial | *(no exact string match — may use helpers)* |
| `/api/admin/users/<string:target_username>/manage` | GET | `manage_user` | `backend/blueprints/admin_users.py:131` | manage user | *(no exact string match — may use helpers)* |
| `/api/admin/delete_user` | POST | `admin_delete_user` | `backend/blueprints/admin_users.py:211` | admin delete user | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Users.tsx` (1) |
| `/login` | GET, POST | `login` | `backend/blueprints/auth.py:191` | login | `client/src/pages/MobileLogin.tsx` (13), `client/src/App.tsx` (4), `client/src/pages/Signup.tsx` (3), `client/src/utils/internalLinkHandler.ts` (3), `admin-web/src/pages/Login.tsx` (3), `admin-web/src/components/AuthGuard.tsx` (2), `admin-web/src/pages/FindAdmin.tsx` (2), `client/src/pages/InvitePreview.tsx` (1) |
| `/signup` | GET, POST | `signup` | `backend/blueprints/auth.py:274` | signup | `client/src/App.tsx` (6), `client/src/pages/MobileLogin.tsx` (2), `client/src/pages/AccountDangerZone.tsx` (1), `client/src/pages/InvitePreview.tsx` (1), `client/src/pages/Signup.tsx` (1), `client/src/utils/internalLinkHandler.ts` (1), `client/src/components/onboarding/AgeGate.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/logout` | GET (default) | `logout` | `backend/blueprints/auth.py:515` | logout | `client/src/utils/logout.test.ts` (4), `client/src/utils/logout.ts` (4), `client/src/utils/clearAllUserData.ts` (3), `client/src/contexts/LogoutPromptContext.tsx` (1), `admin-web/src/components/Layout.tsx` (1) |
| `/delete_account` | POST | `delete_account_post` | `backend/blueprints/auth.py:572` | delete account post | `client/src/pages/AccountDangerZone.tsx` (1), `client/src/components/onboarding/AgeGate.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1), `client/src/components/settings/DangerZoneSheet.tsx` (1) |
| `/login_password` | GET, POST | `login_password` | `backend/blueprints/auth.py:637` | login password | `client/src/pages/MobileLogin.tsx` (1), `admin-web/src/pages/Login.tsx` (1) |
| `/login_back` | GET | `login_back` | `backend/blueprints/auth.py:780` | login back | *(no exact string match — may use helpers)* |
| `/api/check_pending_login` | GET | `api_check_pending_login` | `backend/blueprints/auth.py:790` | api check pending login | `client/src/pages/MobileLogin.tsx` (1) |
| `/api/clear_stale_session` | POST | `api_clear_stale_session` | `backend/blueprints/auth.py:804` | api clear stale session | `client/src/pages/MobileLogin.tsx` (1), `client/src/pages/Signup.tsx` (1) |
| `/api/auth/google` | POST | `google_sign_in` | `backend/blueprints/auth.py:934` | google sign in | `client/src/pages/MobileLogin.tsx` (1) |
| `/api/auth/apple` | POST | `apple_sign_in` | `backend/blueprints/auth.py:1088` | apple sign in | `client/src/pages/MobileLogin.tsx` (1) |
| `/request_password_reset` | POST | `request_password_reset` | `backend/blueprints/auth.py:1246` | request password reset | `client/src/pages/MobileLogin.tsx` (1) |
| `/reset_password/<token>` | GET, POST | `reset_password` | `backend/blueprints/auth.py:1261` | reset password | *(no exact string match — may use helpers)* |
| `/billing_return` | GET | `billing_return_page` | `backend/blueprints/billing_return.py:19` | billing return page | `client/src/pages/BillingReturn.tsx` (1) |
| `/admin/get_onboarding_welcome_video` | GET | `admin_get_onboarding_welcome_video` | `backend/blueprints/branding_assets.py:37` | admin get onboarding welcome video | `client/src/pages/AdminDashboard.tsx` (1) |
| `/admin/upload_onboarding_welcome_video` | POST | `admin_upload_onboarding_welcome_video` | `backend/blueprints/branding_assets.py:48` | admin upload onboarding welcome video | `client/src/pages/AdminDashboard.tsx` (1) |
| `/admin/remove_onboarding_welcome_video` | POST | `admin_remove_onboarding_welcome_video` | `backend/blueprints/branding_assets.py:79` | admin remove onboarding welcome video | `client/src/pages/AdminDashboard.tsx` (1) |
| `/api/public/onboarding_welcome_video` | GET | `api_public_onboarding_welcome_video` | `backend/blueprints/branding_assets.py:90` | api public onboarding welcome video | `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (2), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/api/chat/uploads/init` | POST | `api_chat_uploads_init` | `backend/blueprints/chat_uploads.py:28` | api chat uploads init | `client/src/chat/upload/multipartUploader.ts` (1) |
| `/api/chat/uploads/part-url` | POST | `api_chat_uploads_part_url` | `backend/blueprints/chat_uploads.py:45` | api chat uploads part url | `client/src/chat/upload/multipartUploader.test.ts` (1), `client/src/chat/upload/multipartUploader.ts` (1) |
| `/api/chat/uploads/complete` | POST | `api_chat_uploads_complete` | `backend/blueprints/chat_uploads.py:62` | api chat uploads complete | `client/src/chat/upload/multipartUploader.test.ts` (1), `client/src/chat/upload/multipartUploader.ts` (1) |
| `/api/chat/uploads/abort` | POST | `api_chat_uploads_abort` | `backend/blueprints/chat_uploads.py:76` | api chat uploads abort | `client/src/chat/upload/multipartUploader.ts` (1) |
| `/api/cron/chat-uploads-janitor` | POST | `cron_chat_uploads_janitor` | `backend/blueprints/chat_uploads.py:89` | cron chat uploads janitor | *(no exact string match — may use helpers)* |
| `/communities` | GET (default) | `communities_list` | `backend/blueprints/communities.py:109` | communities list | `client/src/pages/CommunityFeed.tsx` (3), `client/src/pages/EditCommunity.tsx` (3), `client/src/pages/PremiumDashboard.tsx` (3), `client/src/components/pageTransition.test.ts` (2), `client/src/components/community/CommunityOwnerSetupIntro.tsx` (2), `admin-web/src/pages/CommunitiesDirectory.tsx` (2), `admin-web/src/pages/Subscriptions.tsx` (2), `admin-web/src/pages/Tenants.tsx` (2) |
| `/delete_community` | POST | `delete_community` | `backend/blueprints/communities.py:320` | delete community | `client/src/pages/Communities.tsx` (2), `client/src/pages/AdminDashboard.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/EditCommunity.tsx` (1), `admin-web/src/pages/NetworkInsights.tsx` (1) |
| `/api/admin/delete_community` | POST | `admin_delete_community` | `backend/blueprints/communities.py:337` | admin delete community | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/NetworkInsights.tsx` (1) |
| `/api/communities/<int:community_id>/freeze` | POST | `freeze_community` | `backend/blueprints/communities.py:360` | freeze community | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/unfreeze` | POST | `unfreeze_community` | `backend/blueprints/communities.py:384` | unfreeze community | *(no exact string match — may use helpers)* |
| `/api/user_communities_hierarchical` | GET | `user_communities_hierarchical` | `backend/blueprints/communities.py:406` | user communities hierarchical | `client/src/pages/SubscriptionPlans.test.tsx` (4), `client/src/pages/Communities.tsx` (1), `client/src/pages/Messages.tsx` (1), `client/src/utils/serverPull.ts` (1), `client/src/components/subscriptions/CommunityPickerPanel.tsx` (1) |
| `/api/user_parent_community` | GET | `api_user_parent_community` | `backend/blueprints/communities.py:419` | api user parent community | `client/src/pages/PremiumDashboard.tsx` (2), `client/src/utils/dashboardCache.ts` (2), `client/src/components/GroupChatCreator.tsx` (1), `client/src/components/ParentCommunityPicker.tsx` (1), `client/src/pages/HomeTimeline.tsx` (1), `client/src/utils/serverPull.ts` (1) |
| `/api/community_group_feed/<int:parent_id>` | GET | `api_community_group_feed` | `backend/blueprints/communities.py:465` | api community group feed | *(no exact string match — may use helpers)* |
| `/api/dashboard_unread_feed` | GET | `api_dashboard_unread_feed` | `backend/blueprints/communities.py:550` | api dashboard unread feed | `client/src/pages/HomeTimeline.tsx` (1) |
| `/get_community_members` | POST | `get_community_members` | `backend/blueprints/communities.py:880` | get community members | `client/src/pages/CommunityFeed.tsx` (2), `client/src/components/ContentGenerationModal.tsx` (1), `client/src/components/GroupChatCreator.tsx` (1), `client/src/components/ParentCommunityPicker.tsx` (1), `client/src/pages/CommunityTasks.tsx` (1), `client/src/pages/EditCommunity.tsx` (1), `client/src/pages/Members.tsx` (1) |
| `/add_community_member` | POST | `add_community_member` | `backend/blueprints/communities.py:1001` | add community member | `client/src/pages/AdminDashboard.tsx` (1) |
| `/update_member_role` | POST | `update_member_role` | `backend/blueprints/communities.py:1056` | update member role | `client/src/pages/Members.tsx` (1) |
| `/remove_community_member` | POST | `remove_community_member` | `backend/blueprints/communities.py:1220` | remove community member | `client/src/pages/Members.tsx` (1) |
| `/api/member/accessible_subcommunities` | POST | `get_accessible_subcommunities` | `backend/blueprints/communities.py:1280` | get accessible subcommunities | `client/src/pages/Members.tsx` (1) |
| `/api/member/add_to_subcommunity` | POST | `add_member_to_subcommunity` | `backend/blueprints/communities.py:1392` | add member to subcommunity | `client/src/pages/Members.tsx` (1) |
| `/api/cron/communities/lifecycle-dispatch` | POST | `cron_community_lifecycle_dispatch` | `backend/blueprints/communities.py:1555` | cron community lifecycle dispatch | *(no exact string match — may use helpers)* |
| `/api/cron/communities/rolling-welcome` | POST | `cron_community_rolling_welcome` | `backend/blueprints/communities.py:1580` | cron community rolling welcome | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/republish_welcome_post` | POST | `republish_welcome_post` | `backend/blueprints/communities.py:1611` | republish welcome post | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/owner-feed-setup-intro-seen` | POST | `mark_owner_feed_setup_intro_seen` | `backend/blueprints/communities.py:1653` | mark owner feed setup intro seen | *(no exact string match — may use helpers)* |
| `/get_calendar_events` | GET (default) | `get_calendar_events` | `backend/blueprints/community_calendar.py:64` | get calendar events | `client/src/pages/CommunityCalendar.tsx` (1) |
| `/api/all_calendar_events` | GET (default) | `api_all_calendar_events` | `backend/blueprints/community_calendar.py:73` | api all calendar events | `client/src/pages/Notifications.tsx` (1) |
| `/api/group_calendar/<int:group_id>` | GET (default) | `api_group_calendar` | `backend/blueprints/community_calendar.py:82` | api group calendar | *(no exact string match — may use helpers)* |
| `/api/calendar_events/<int:event_id>` | GET (default) | `api_get_calendar_event` | `backend/blueprints/community_calendar.py:91` | api get calendar event | *(no exact string match — may use helpers)* |
| `/get_calendar_event/<int:event_id>` | GET (default) | `get_calendar_event` | `backend/blueprints/community_calendar.py:100` | get calendar event | *(no exact string match — may use helpers)* |
| `/api/calendar_events/<int:event_id>/ics` | GET | `api_calendar_event_ics` | `backend/blueprints/community_calendar.py:109` | api calendar event ics | *(no exact string match — may use helpers)* |
| `/add_calendar_event` | POST | `add_calendar_event` | `backend/blueprints/community_calendar.py:135` | add calendar event | `client/src/pages/CommunityCalendar.tsx` (1) |
| `/edit_calendar_event` | POST | `edit_calendar_event` | `backend/blueprints/community_calendar.py:149` | edit calendar event | `client/src/pages/CommunityCalendar.tsx` (1) |
| `/delete_calendar_event` | POST | `delete_calendar_event` | `backend/blueprints/community_calendar.py:165` | delete calendar event | `client/src/pages/CommunityCalendar.tsx` (1), `client/src/pages/EventDetail.tsx` (1) |
| `/event/<int:event_id>/rsvp` | POST | `rsvp_event` | `backend/blueprints/community_calendar.py:181` | rsvp event | *(no exact string match — may use helpers)* |
| `/event/<int:event_id>/rsvp` | DELETE | `cancel_rsvp` | `backend/blueprints/community_calendar.py:194` | cancel rsvp | *(no exact string match — may use helpers)* |
| `/event/<int:event_id>/rsvps` | GET (default) | `get_event_rsvps` | `backend/blueprints/community_calendar.py:204` | get event rsvps | *(no exact string match — may use helpers)* |
| `/get_event_rsvp_details` | GET (default) | `get_event_rsvp_details` | `backend/blueprints/community_calendar.py:224` | get event rsvp details | `client/src/pages/EventDetail.tsx` (1) |
| `/api/community/<int:community_id>/analytics/overview` | GET | `analytics_overview` | `backend/blueprints/owner_analytics.py:33` | Owner Dashboard overview metrics (owner/admin-gated, non-enumerating) | `client/src/pages/OwnerDashboard.tsx` (1) |
| `/api/community/<int:community_id>/analytics/spaces` | GET | `analytics_spaces` | `backend/blueprints/owner_analytics.py:70` | Owner Dashboard sub-communities + groups list | `client/src/components/owner/SpacesTab.tsx` (1) |
| `/api/owner/communities` | GET | `owner_communities` | `backend/blueprints/owner_analytics.py:44` | Owner Dashboard switcher — communities the caller owns/manages + tier | `client/src/pages/OwnerDashboard.tsx` (1) |
| `/api/community/<int:community_id>/handle_settings` | GET | `handle_settings_get` | `backend/blueprints/community_handles.py:20` | handle settings get | *(no exact string match — may use helpers)* |
| `/api/community/<int:community_id>/handle_settings` | POST | `handle_settings_post` | `backend/blueprints/community_handles.py:33` | handle settings post | *(no exact string match — may use helpers)* |
| `/api/community/by_handle/<handle>` | GET | `lookup_by_handle` | `backend/blueprints/community_handles.py:55` | lookup by handle | *(no exact string match — may use helpers)* |
| `/api/community/<int:community_id>/join_requests` | POST | `join_request_create` | `backend/blueprints/community_handles.py:70` | join request create | *(no exact string match — may use helpers)* |
| `/api/community/<int:community_id>/join_requests/mine` | DELETE | `join_request_withdraw` | `backend/blueprints/community_handles.py:83` | join request withdraw | *(no exact string match — may use helpers)* |
| `/api/community/join_requests/pending` | GET | `join_requests_pending` | `backend/blueprints/community_handles.py:96` | join requests pending | `client/src/pages/Notifications.tsx` (1) |
| `/api/community/<int:community_id>/join_requests/count` | GET | `join_requests_count` | `backend/blueprints/community_handles.py:110` | join requests count | *(no exact string match — may use helpers)* |
| `/api/community/<int:community_id>/join_requests/decide` | POST | `join_request_decide` | `backend/blueprints/community_handles.py:123` | join request decide | *(no exact string match — may use helpers)* |
| `/api/community/handle_check` | GET | `handle_check` | `backend/blueprints/community_handles.py:143` | handle check | `client/src/components/community/HandleSettings.tsx` (1) |
| `/api/community/<int:community_id>/invite_settings` | GET, POST | `community_invite_settings` | `backend/blueprints/community_invites.py:45` | community invite settings | *(no exact string match — may use helpers)* |
| `/api/community/invite_link` | POST | `generate_invite_link` | `backend/blueprints/community_invites.py:52` | generate invite link | `client/src/pages/AdminDashboard.tsx` (1), `client/src/pages/Members.tsx` (1), `admin-web/src/pages/Invites.tsx` (1) |
| `/api/community/manageable` | GET | `list_manageable_communities` | `backend/blueprints/community_invites.py:68` | list manageable communities | `client/src/pages/Members.tsx` (1), `client/src/pages/PublicProfile.tsx` (1) |
| `/api/community/invite_username` | POST | `invite_username_to_community` | `backend/blueprints/community_invites.py:75` | invite username to community | `client/src/pages/Members.tsx` (1), `client/src/pages/PublicProfile.tsx` (1) |
| `/api/community/invites/pending` | GET | `list_pending_username_invites` | `backend/blueprints/community_invites.py:84` | list pending username invites | `client/src/pages/Notifications.tsx` (1), `client/src/pages/PremiumDashboard.tsx` (1) |
| `/api/community/invites/<int:invite_id>/accept` | POST | `accept_username_invite` | `backend/blueprints/community_invites.py:91` | accept username invite | *(no exact string match — may use helpers)* |
| `/api/community/invites/<int:invite_id>/decline` | POST | `decline_username_invite` | `backend/blueprints/community_invites.py:97` | decline username invite | *(no exact string match — may use helpers)* |
| `/api/invite_preview/<invite_token>` | GET | `invite_preview` | `backend/blueprints/community_invites.py:103` | invite preview | *(no exact string match — may use helpers)* |
| `/api/community/invites/token/<invite_token>/accept` | POST | `accept_token_invite` | `backend/blueprints/community_invites.py:109` | accept token invite | *(no exact string match — may use helpers)* |
| `/api/community/invites/token/<invite_token>/decline` | POST | `decline_token_invite` | `backend/blueprints/community_invites.py:115` | decline token invite | *(no exact string match — may use helpers)* |
| `/api/join_with_invite` | POST | `join_with_invite` | `backend/blueprints/community_invites.py:121` | join with invite | *(no exact string match — may use helpers)* |
| `/api/invite_info` | POST | `get_invite_info` | `backend/blueprints/community_invites.py:128` | get invite info | *(no exact string match — may use helpers)* |
| `/api/community/invite` | POST | `invite_to_community` | `backend/blueprints/community_invites.py:135` | invite to community | `client/src/pages/Members.tsx` (3), `client/src/pages/PremiumDashboard.tsx` (3), `admin-web/src/pages/Invites.tsx` (3), `client/src/pages/AdminDashboard.tsx` (2), `client/src/pages/InvitePreview.tsx` (2), `client/src/pages/Notifications.tsx` (2), `client/src/pages/PublicProfile.tsx` (1) |
| `/api/community/invite_bulk` | POST | `invite_to_community_bulk` | `backend/blueprints/community_invites.py:150` | invite to community bulk | `admin-web/src/pages/Invites.tsx` (1) |
| `/api/community_stories/<int:community_id>` | GET (default) | `api_community_stories` | `backend/blueprints/community_stories.py:36` | api community stories | *(no exact string match — may use helpers)* |
| `/api/community_stories` | POST | `create_community_story` | `backend/blueprints/community_stories.py:42` | create community story | `client/src/pages/CommunityFeed.tsx` (10) |
| `/api/community_stories/view` | POST | `api_mark_story_view` | `backend/blueprints/community_stories.py:48` | api mark story view | `client/src/pages/CommunityFeed.tsx` (1) |
| `/api/community_stories/<int:story_id>/viewers` | GET | `api_get_story_viewers` | `backend/blueprints/community_stories.py:60` | api get story viewers | *(no exact string match — may use helpers)* |
| `/api/story/<int:story_id>` | GET | `get_community_story` | `backend/blueprints/community_stories.py:66` | get community story | *(no exact string match — may use helpers)* |
| `/api/community_stories/<int:story_id>` | DELETE | `delete_community_story` | `backend/blueprints/community_stories.py:72` | delete community story | *(no exact string match — may use helpers)* |
| `/api/community_stories/group/<story_group_id>` | DELETE | `delete_community_story_group` | `backend/blueprints/community_stories.py:78` | delete community story group | *(no exact string match — may use helpers)* |
| `/api/community_stories/react` | POST | `api_story_reaction` | `backend/blueprints/community_stories.py:84` | api story reaction | `client/src/pages/CommunityFeed.tsx` (1) |
| `/api/community_stories/<int:story_id>/comments` | GET (default) | `api_get_story_comments` | `backend/blueprints/community_stories.py:96` | api get story comments | *(no exact string match — may use helpers)* |
| `/api/community_stories/<int:story_id>/comments` | POST | `api_add_story_comment` | `backend/blueprints/community_stories.py:102` | api add story comment | *(no exact string match — may use helpers)* |
| `/api/community_stories/comments/<int:comment_id>` | DELETE | `api_delete_story_comment` | `backend/blueprints/community_stories.py:110` | api delete story comment | *(no exact string match — may use helpers)* |
| `/api/content-generation/schedule-preview` | POST | `content_generation_schedule_preview_api` | `backend/blueprints/content_generation.py:166` | content generation schedule preview api | `client/src/components/ContentGenerationModal.tsx` (1), `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/content-generation/ideas` | GET | `content_generation_ideas_api` | `backend/blueprints/content_generation.py:181` | content generation ideas api | `client/src/components/ContentGenerationModal.tsx` (1), `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/content-generation/jobs` | GET | `content_generation_jobs_api` | `backend/blueprints/content_generation.py:190` | content generation jobs api | `client/src/components/ContentGenerationModal.tsx` (7), `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/content-generation/runs` | GET | `content_generation_runs_api` | `backend/blueprints/content_generation.py:209` | content generation runs api | `client/src/components/ContentGenerationModal.tsx` (2) |
| `/api/content-generation/jobs` | POST | `create_content_generation_job_api` | `backend/blueprints/content_generation.py:222` | create content generation job api | `client/src/components/ContentGenerationModal.tsx` (7), `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/content-generation/jobs/<int:job_id>` | PATCH | `update_content_generation_job_api` | `backend/blueprints/content_generation.py:268` | update content generation job api | *(no exact string match — may use helpers)* |
| `/api/content-generation/jobs/<int:job_id>` | DELETE | `delete_content_generation_job_api` | `backend/blueprints/content_generation.py:302` | delete content generation job api | *(no exact string match — may use helpers)* |
| `/api/content-generation/runs/<int:run_id>` | DELETE | `delete_content_generation_run_api` | `backend/blueprints/content_generation.py:317` | delete content generation run api | *(no exact string match — may use helpers)* |
| `/api/content-generation/jobs` | DELETE | `delete_content_generation_jobs_bulk_api` | `backend/blueprints/content_generation.py:332` | delete content generation jobs bulk api | `client/src/components/ContentGenerationModal.tsx` (7), `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/content-generation/runs` | DELETE | `delete_content_generation_runs_bulk_api` | `backend/blueprints/content_generation.py:348` | delete content generation runs bulk api | `client/src/components/ContentGenerationModal.tsx` (2) |
| `/api/content-generation/jobs/<int:job_id>/run` | POST | `run_content_generation_job_api` | `backend/blueprints/content_generation.py:364` | run content generation job api | *(no exact string match — may use helpers)* |
| `/api/admin/content-generation/jobs` | GET | `admin_content_generation_jobs_api` | `backend/blueprints/content_generation.py:382` | admin content generation jobs api | `admin-web/src/pages/ContentGeneration.tsx` (5) |
| `/api/admin/content-generation/runs` | GET | `admin_content_generation_runs_api` | `backend/blueprints/content_generation.py:392` | admin content generation runs api | `admin-web/src/pages/ContentGeneration.tsx` (3) |
| `/api/admin/content-generation/jobs` | POST | `admin_create_content_generation_jobs_api` | `backend/blueprints/content_generation.py:403` | admin create content generation jobs api | `admin-web/src/pages/ContentGeneration.tsx` (5) |
| `/api/admin/content-generation/jobs` | DELETE | `admin_delete_all_content_generation_jobs_api` | `backend/blueprints/content_generation.py:483` | admin delete all content generation jobs api | `admin-web/src/pages/ContentGeneration.tsx` (5) |
| `/api/admin/content-generation/jobs/<int:job_id>` | DELETE | `admin_delete_content_generation_job_api` | `backend/blueprints/content_generation.py:497` | admin delete content generation job api | *(no exact string match — may use helpers)* |
| `/api/admin/content-generation/runs/<int:run_id>` | DELETE | `admin_delete_content_generation_run_api` | `backend/blueprints/content_generation.py:512` | admin delete content generation run api | *(no exact string match — may use helpers)* |
| `/api/admin/content-generation/runs` | DELETE | `admin_delete_content_generation_runs_bulk_api` | `backend/blueprints/content_generation.py:524` | admin delete content generation runs bulk api | `admin-web/src/pages/ContentGeneration.tsx` (3) |
| `/api/admin/content-generation/jobs/<int:job_id>/run` | POST | `admin_run_content_generation_job_api` | `backend/blueprints/content_generation.py:542` | admin run content generation job api | *(no exact string match — may use helpers)* |
| `/api/content-generation/cron/process-due-jobs` | POST | `api_process_due_content_generation_jobs` | `backend/blueprints/content_generation.py:560` | api process due content generation jobs | *(no exact string match — may use helpers)* |
| `/api/articles/read` | GET | `api_read_article` | `backend/blueprints/content_generation.py:597` | api read article | *(no exact string match — may use helpers)* |
| `/api/chat_threads` | GET | `api_chat_threads` | `backend/blueprints/dm_chats.py:82` | api chat threads | `client/src/pages/Messages.tsx` (2) |
| `/check_unread_messages` | GET | `check_unread_messages` | `backend/blueprints/dm_chats.py:92` | check unread messages | `client/src/contexts/BadgeContext.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/chat/clear_history` | POST | `clear_chat_history` | `backend/blueprints/dm_chats.py:146` | clear chat history | `client/src/pages/Messages.tsx` (1) |
| `/delete_chat_thread` | POST | `delete_chat_thread` | `backend/blueprints/dm_chats.py:185` | delete chat thread | `client/src/pages/Messages.tsx` (2) |
| `/api/chat/dm/remove_message_media` | POST | `remove_dm_message_media` | `backend/blueprints/dm_chats.py:231` | remove dm message media | `client/src/pages/ChatThread.tsx` (1) |
| `/api/chat/dm/remove_media_bulk` | POST | `remove_dm_media_bulk` | `backend/blueprints/dm_chats.py:438` | remove dm media bulk | `client/src/chat/MediaGalleryPage.tsx` (1) |
| `/api/chat/dm/send_document` | POST | `send_dm_document` | `backend/blueprints/dm_chats.py:479` | send dm document | `client/src/chat/mediaSenders.ts` (1) |
| `/api/chat/documents` | GET | `get_dm_documents` | `backend/blueprints/dm_chats.py:512` | get dm documents | `client/src/pages/ChatDocuments.tsx` (1) |
| `/send_message` | POST | `send_message` | `backend/blueprints/dm_chats.py:527` | send message | `client/src/pages/ChatThread.tsx` (2), `client/src/pages/CommunityFeed.tsx` (1), `client/src/utils/outboxDrain.ts` (1) |
| `/send_photo_message` | POST | `send_photo_message` | `backend/blueprints/dm_chats.py:547` | send photo message | `client/src/chat/groupChatMediaSenders.ts` (1), `client/src/chat/mediaSenders.ts` (1) |
| `/send_dm_media` | POST | `send_dm_media` | `backend/blueprints/dm_chats.py:564` | send dm media | `client/src/chat/mediaSenders.ts` (3), `client/src/hooks/useMediaUploadResume.ts` (1) |
| `/send_video_message` | POST | `send_video_message` | `backend/blueprints/dm_chats.py:584` | send video message | `client/src/chat/mediaSenders.ts` (3) |
| `/send_audio_message` | POST | `send_audio_message` | `backend/blueprints/dm_chats.py:603` | send audio message | `client/src/pages/ChatThread.tsx` (3) |
| `/get_messages` | POST | `get_messages` | `backend/blueprints/dm_chats.py:626` | get messages | `client/src/pages/ChatThread.tsx` (4), `client/src/chat/useDmMessagePoll.ts` (2) |
| `/api/chat/mute` | POST | `mute_chat` | `backend/blueprints/dm_chats.py:640` | mute chat | `client/src/pages/Messages.tsx` (1) |
| `/api/archive_chat` | POST | `archive_chat` | `backend/blueprints/dm_chats.py:655` | archive chat | `client/src/pages/Messages.tsx` (1) |
| `/api/unarchive_chat` | POST | `unarchive_chat` | `backend/blueprints/dm_chats.py:664` | unarchive chat | `client/src/pages/Messages.tsx` (1) |
| `/api/archived_chats` | GET (default) | `api_archived_chats` | `backend/blueprints/dm_chats.py:673` | api archived chats | `client/src/pages/Messages.tsx` (1) |
| `/api/active_chat` | POST | `api_active_chat` | `backend/blueprints/dm_chats.py:684` | api active chat | `client/src/chat/useDmMessagePoll.ts` (1) |
| `/delete_message` | POST | `delete_message` | `backend/blueprints/dm_chats.py:696` | delete message | `client/src/pages/ChatThread.tsx` (2) |
| `/api/chat/edit_message` | POST | `edit_message_api` | `backend/blueprints/dm_chats.py:704` | edit message api | `client/src/pages/ChatThread.tsx` (1) |
| `/api/chat/update_audio_summary` | POST | `update_dm_audio_summary_route` | `backend/blueprints/dm_chats.py:723` | update dm audio summary route | `client/src/pages/ChatThread.tsx` (1) |
| `/api/chat/media` | GET | `get_chat_media` | `backend/blueprints/dm_chats.py:740` | get chat media | `client/src/chat/MediaGalleryPage.tsx` (1) |
| `/api/chat/react_to_message` | POST | `react_to_message` | `backend/blueprints/dm_chats.py:750` | react to message | `client/src/pages/ChatThread.tsx` (1) |
| `/api/dm/search` | GET | `api_dm_search` | `backend/blueprints/dm_chats.py:772` | api dm search | `client/src/chat/ChatThreadSearch.tsx` (1) |
| `/api/dm/messages_around` | GET | `api_dm_messages_around` | `backend/blueprints/dm_chats.py:794` | api dm messages around | `client/src/pages/ChatThread.tsx` (1) |
| `/api/cron/refresh_embedding_index` | POST | `api_cron_refresh_embedding_index` | `backend/blueprints/embedding_index.py:28` | api cron refresh embedding index | *(no exact string match — may use helpers)* |
| `/api/me/enterprise-seats` | GET | `me_seats` | `backend/blueprints/enterprise.py:90` | me seats | *(no exact string match — may use helpers)* |
| `/api/me/iap-nag` | GET | `me_iap_nag` | `backend/blueprints/enterprise.py:98` | me iap nag | *(no exact string match — may use helpers)* |
| `/api/me/iap-nag/ack` | POST | `me_iap_nag_ack` | `backend/blueprints/enterprise.py:116` | me iap nag ack | *(no exact string match — may use helpers)* |
| `/api/me/winback` | GET | `me_winback` | `backend/blueprints/enterprise.py:130` | me winback | *(no exact string match — may use helpers)* |
| `/api/me/winback/redeem` | POST | `me_winback_redeem` | `backend/blueprints/enterprise.py:138` | me winback redeem | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/enterprise/seat/start` | POST | `start_seat` | `backend/blueprints/enterprise.py:159` | start seat | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/enterprise/seat/end` | POST | `end_seat` | `backend/blueprints/enterprise.py:199` | end seat | *(no exact string match — may use helpers)* |
| `/api/admin/enterprise/seats` | GET | `admin_list_seats` | `backend/blueprints/enterprise.py:240` | admin list seats | `admin-web/src/pages/Enterprise.tsx` (2) |
| `/api/admin/enterprise/seats/override-end` | POST | `admin_override_end` | `backend/blueprints/enterprise.py:247` | admin override end | `admin-web/src/pages/Enterprise.tsx` (1) |
| `/api/admin/enterprise/communities/<int:community_id>/tier` | POST | `admin_set_community_tier` | `backend/blueprints/enterprise.py:272` | admin set community tier | *(no exact string match — may use helpers)* |
| `/api/admin/subscription-audit` | GET | `admin_subscription_audit` | `backend/blueprints/enterprise.py:352` | admin subscription audit | `admin-web/src/pages/Enterprise.tsx` (1) |
| `/api/admin/winback/analytics` | GET | `admin_winback_analytics` | `backend/blueprints/enterprise.py:377` | admin winback analytics | `admin-web/src/pages/Enterprise.tsx` (2) |
| `/api/cron/enterprise/grace-sweep` | POST | `cron_grace_sweep` | `backend/blueprints/enterprise.py:452` | cron grace sweep | *(no exact string match — may use helpers)* |
| `/api/cron/enterprise/nag-dispatch` | POST | `cron_nag_dispatch` | `backend/blueprints/enterprise.py:460` | cron nag dispatch | *(no exact string match — may use helpers)* |
| `/api/cron/enterprise/winback-expire` | POST | `cron_winback_expire` | `backend/blueprints/enterprise.py:468` | cron winback expire | *(no exact string match — may use helpers)* |
| `/api/cron/subscriptions/revoke-expired` | POST | `cron_revoke_expired_subscriptions` | `backend/blueprints/enterprise.py:476` | cron revoke expired subscriptions | *(no exact string match — may use helpers)* |
| `/api/cron/ai-usage/daily-rollup` | POST | `cron_ai_usage_daily_rollup` | `backend/blueprints/enterprise.py:558` | cron ai usage daily rollup | *(no exact string match — may use helpers)* |
| `/api/cron/usage/cycle-notify` | POST | `cron_usage_cycle_notify` | `backend/blueprints/enterprise.py:569` | cron usage cycle notify | *(no exact string match — may use helpers)* |
| `/api/upload_chat_media` | POST | `upload_chat_media` | `backend/blueprints/group_chat.py:530` | upload chat media | *(no exact string match — may use helpers)* |
| `/api/upload_chat_image` | POST | `upload_chat_image` | `backend/blueprints/group_chat.py:582` | upload chat image | *(no exact string match — may use helpers)* |
| `/api/group_chat/create` | POST | `create_group_chat` | `backend/blueprints/group_chat.py:589` | create group chat | `client/src/components/GroupChatCreator.tsx` (1) |
| `/api/group_chat/list` | GET | `list_group_chats` | `backend/blueprints/group_chat.py:690` | list group chats | `client/src/pages/Messages.tsx` (1) |
| `/api/group_chat/<int:group_id>` | GET | `get_group_chat` | `backend/blueprints/group_chat.py:832` | get group chat | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/presence` | POST | `update_group_presence` | `backend/blueprints/group_chat.py:910` | update group presence | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/messages` | GET | `get_group_messages` | `backend/blueprints/group_chat.py:981` | get group messages | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/media` | GET | `get_group_media` | `backend/blueprints/group_chat.py:996` | get group media | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/documents` | GET | `get_group_documents` | `backend/blueprints/group_chat.py:1093` | get group documents | *(no exact string match — may use helpers)* |
| `/api/upload_voice_message` | POST | `upload_voice_message` | `backend/blueprints/group_chat.py:1125` | upload voice message | `client/src/pages/GroupChatThread.tsx` (3) |
| `/api/group_chat/<int:group_id>/send_media` | POST | `send_group_media` | `backend/blueprints/group_chat.py:1158` | send group media | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/send_document` | POST | `send_group_document` | `backend/blueprints/group_chat.py:1404` | send group document | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/send` | POST | `send_group_message` | `backend/blueprints/group_chat.py:1480` | send group message | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/leave` | POST | `leave_group_chat` | `backend/blueprints/group_chat.py:1828` | leave group chat | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/delete` | POST | `delete_group_chat` | `backend/blueprints/group_chat.py:1891` | delete group chat | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/clear_history` | POST | `clear_group_chat_history` | `backend/blueprints/group_chat.py:1936` | clear group chat history | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/remove_member` | POST | `remove_group_member` | `backend/blueprints/group_chat.py:1995` | remove group member | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/rename` | POST | `rename_group_chat` | `backend/blueprints/group_chat.py:2045` | rename group chat | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/steve_personality` | GET, POST | `group_steve_personality` | `backend/blueprints/group_chat.py:2086` | group steve personality | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/steve_reset_context` | POST | `reset_steve_context` | `backend/blueprints/group_chat.py:2127` | reset steve context | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/message/<int:message_id>/delete` | POST | `delete_group_message` | `backend/blueprints/group_chat.py:2170` | delete group message | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/remove_message_media` | POST | `remove_group_message_media` | `backend/blueprints/group_chat.py:2234` | remove group message media | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/remove_media_bulk` | POST | `remove_group_media_bulk` | `backend/blueprints/group_chat.py:2436` | remove group media bulk | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/message/<int:message_id>/update_summary` | POST | `update_group_audio_summary` | `backend/blueprints/group_chat.py:2478` | update group audio summary | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/messages/bulk_delete` | POST | `bulk_delete_group_messages` | `backend/blueprints/group_chat.py:2517` | bulk delete group messages | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/message/<int:message_id>/edit` | POST | `edit_group_message` | `backend/blueprints/group_chat.py:2581` | edit group message | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/message/<int:message_id>/react` | POST | `react_to_group_message` | `backend/blueprints/group_chat.py:2636` | react to group message | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/available_members` | GET | `get_available_members` | `backend/blueprints/group_chat.py:2701` | get available members | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/add_members` | POST | `add_members_to_group` | `backend/blueprints/group_chat.py:2766` | add members to group | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/search` | GET | `api_group_chat_search` | `backend/blueprints/group_chat.py:2876` | api group chat search | *(no exact string match — may use helpers)* |
| `/api/group_chat/<int:group_id>/messages_around` | GET | `api_group_messages_around` | `backend/blueprints/group_chat.py:2897` | api group messages around | *(no exact string match — may use helpers)* |
| `/api/group_feed` | GET | `api_group_feed` | `backend/blueprints/group_feed.py:193` | api group feed | `client/src/pages/CreatePost.tsx` (1), `client/src/pages/GroupFeed.tsx` (1) |
| `/api/group_post_view` | POST | `api_group_post_view` | `backend/blueprints/group_feed.py:205` | api group post view | `client/src/pages/PostDetail.tsx` (1) |
| `/api/group_announcements/<int:group_id>` | GET | `api_group_announcements_list` | `backend/blueprints/group_feed.py:234` | api group announcements list | *(no exact string match — may use helpers)* |
| `/api/group_announcements/<int:group_id>` | POST | `api_group_announcements_create` | `backend/blueprints/group_feed.py:276` | api group announcements create | *(no exact string match — may use helpers)* |
| `/api/group_posts_search` | GET | `api_group_posts_search` | `backend/blueprints/group_feed.py:323` | api group posts search | `client/src/pages/GroupFeed.tsx` (1) |
| `/api/group_photos/<int:group_id>` | GET | `api_group_photos` | `backend/blueprints/group_feed.py:368` | api group photos | *(no exact string match — may use helpers)* |
| `/api/group_key_posts/<int:group_id>` | GET | `api_group_key_posts` | `backend/blueprints/group_feed.py:565` | api group key posts | *(no exact string match — may use helpers)* |
| `/api/toggle_group_key_post` | POST | `api_toggle_group_key_post` | `backend/blueprints/group_feed.py:625` | api toggle group key post | `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/toggle_group_community_key_post` | POST | `api_toggle_group_community_key_post` | `backend/blueprints/group_feed.py:685` | api toggle group community key post | `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/group_poll_vote` | POST | `api_group_poll_vote` | `backend/blueprints/group_feed.py:756` | api group poll vote | `client/src/pages/GroupFeed.tsx` (1) |
| `/api/group_polls/create` | POST | `api_group_polls_create` | `backend/blueprints/group_feed.py:794` | api group polls create | *(no exact string match — may use helpers)* |
| `/api/group_reply/<int:reply_id>` | GET (default) | `api_group_get_reply` | `backend/blueprints/group_feed.py:872` | api group get reply | *(no exact string match — may use helpers)* |
| `/api/group_reply_view` | POST | `api_group_reply_view` | `backend/blueprints/group_feed.py:898` | api group reply view | `client/src/pages/CommentReply.tsx` (1) |
| `/api/group_reply_reactors/<int:reply_id>` | GET (default) | `api_group_reply_reactors` | `backend/blueprints/group_feed.py:933` | api group reply reactors | *(no exact string match — may use helpers)* |
| `/api/group_replies/edit` | POST | `api_group_replies_edit` | `backend/blueprints/group_feed.py:1052` | api group replies edit | `client/src/pages/CommentReply.tsx` (2) |
| `/api/group_replies/delete` | POST | `api_group_replies_delete` | `backend/blueprints/group_feed.py:1108` | api group replies delete | `client/src/pages/CommentReply.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/iap/config` | GET | `api_iap_config` | `backend/blueprints/iap.py:24` | api iap config | `client/src/pages/SubscriptionPlans.test.tsx` (1), `client/src/utils/mobileStoreBilling.ts` (1) |
| `/api/iap/apple/confirm` | POST | `api_iap_apple_confirm` | `backend/blueprints/iap.py:31` | api iap apple confirm | *(no exact string match — may use helpers)* |
| `/api/iap/apple/restore` | POST | `api_iap_apple_restore` | `backend/blueprints/iap.py:36` | api iap apple restore | *(no exact string match — may use helpers)* |
| `/api/iap/google/confirm` | POST | `api_iap_google_confirm` | `backend/blueprints/iap.py:41` | api iap google confirm | *(no exact string match — may use helpers)* |
| `/api/iap/google/restore` | POST | `api_iap_google_restore` | `backend/blueprints/iap.py:46` | api iap google restore | *(no exact string match — may use helpers)* |
| `/api/admin/kb/pages` | GET | `kb_list_pages` | `backend/blueprints/knowledge_base.py:67` | kb list pages | `admin-web/src/pages/KnowledgeBase.tsx` (3), `admin-web/src/pages/Calculator.tsx` (2) |
| `/api/admin/kb/pages/<slug>` | GET | `kb_get_page` | `backend/blueprints/knowledge_base.py:102` | kb get page | *(no exact string match — may use helpers)* |
| `/api/admin/kb/pages/<slug>` | PUT | `kb_save_page` | `backend/blueprints/knowledge_base.py:117` | kb save page | *(no exact string match — may use helpers)* |
| `/api/admin/kb/changelog` | GET | `kb_changelog` | `backend/blueprints/knowledge_base.py:173` | kb changelog | `admin-web/src/pages/KnowledgeBase.tsx` (1) |
| `/api/admin/kb/seed` | POST | `kb_seed` | `backend/blueprints/knowledge_base.py:190` | kb seed | `admin-web/src/pages/KnowledgeBase.tsx` (1) |
| `/api/admin/kb/tests/<test_id>/status` | PATCH | `kb_update_test_status` | `backend/blueprints/knowledge_base.py:239` | kb update test status | *(no exact string match — may use helpers)* |
| `/api/admin/kb/special-access/audit` | GET | `kb_special_access_audit` | `backend/blueprints/knowledge_base.py:279` | kb special access audit | *(no exact string match — may use helpers)* |
| `/api/admin/kb/special-access/revoke-expired` | POST | `kb_special_access_revoke_expired` | `backend/blueprints/knowledge_base.py:298` | kb special access revoke expired | *(no exact string match — may use helpers)* |
| `/api/me/entitlements` | GET | `me_entitlements` | `backend/blueprints/me.py:145` | me entitlements | `client/src/hooks/useEntitlements.ts` (4) |
| `/api/me/locale` | GET | `me_locale_get` | `backend/blueprints/me.py:183` | me locale get | `client/src/i18n/useLocale.ts` (2), `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (2), `client/src/components/LocaleBootstrap.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/api/me/locale` | PATCH, POST | `me_locale_set` | `backend/blueprints/me.py:206` | me locale set | `client/src/i18n/useLocale.ts` (2), `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (2), `client/src/components/LocaleBootstrap.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/api/me/basic_profile` | GET, POST | `me_basic_profile` | `backend/blueprints/me.py:242` | me basic profile | `client/src/components/basic-profile/useBasicProfileForm.ts` (4), `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (3), `client/src/components/basic-profile/BasicProfileGateProvider.test.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/api/me/ai-usage` | GET | `me_ai_usage` | `backend/blueprints/me.py:285` | me ai usage | `client/src/pages/MembershipAIUsage.tsx` (2), `client/src/components/membership/ManageMembershipModal.tsx` (1) |
| `/api/me/billing` | GET | `me_billing` | `backend/blueprints/me.py:554` | me billing | `client/src/components/membership/ManageMembershipModal.tsx` (5), `client/src/pages/Success.tsx` (2), `client/src/pages/EditCommunity.tsx` (1), `client/src/pages/SubscriptionPlans.tsx` (1), `client/src/components/membership/PaidCommunitiesBillingSection.tsx` (1) |
| `/api/me/payment-history` | GET | `me_payment_history` | `backend/blueprints/me.py:632` | me payment history | `client/src/components/membership/ManageMembershipModal.tsx` (1) |
| `/api/me/billing/portal` | POST | `me_billing_portal` | `backend/blueprints/me.py:669` | me billing portal | `client/src/pages/Success.tsx` (2), `client/src/components/membership/ManageMembershipModal.tsx` (2), `client/src/pages/EditCommunity.tsx` (1), `client/src/pages/SubscriptionPlans.tsx` (1), `client/src/components/membership/PaidCommunitiesBillingSection.tsx` (1) |
| `/api/me/age-gate` | GET | `me_age_gate_status` | `backend/blueprints/me.py:798` | me age gate status | `client/src/components/onboarding/AgeGate.test.tsx` (1), `client/src/components/onboarding/AgeGate.tsx` (1) |
| `/api/me/age-confirmation` | POST | `me_age_confirmation` | `backend/blueprints/me.py:821` | me age confirmation | `client/src/components/onboarding/AgeGate.test.tsx` (1), `client/src/components/onboarding/AgeGate.tsx` (1) |
| `/api/cron/purge-underage` | POST | `cron_purge_underage` | `backend/blueprints/me.py:886` | cron purge underage | *(no exact string match — may use helpers)* |
| `/api/me/spotlight-ask` | GET, POST | `me_spotlight_ask` | `backend/blueprints/me.py:922` | me spotlight ask | `client/src/components/dashboard/SpotlightAsk.tsx` (2) |
| `/api/me/communities-spotlight-tour-seen` | POST | `mark_communities_spotlight_tour_seen` | `backend/blueprints/me.py:951` | mark communities spotlight tour seen | `client/src/pages/Communities.tsx` (1) |
| `/api/message_image_upload_url` | POST | `api_message_image_upload_url` | `backend/blueprints/media_assets.py:74` | api message image upload url | `client/src/chat/mediaSenders.ts` (1) |
| `/api/video_upload_url` | POST | `api_video_upload_url` | `backend/blueprints/media_assets.py:98` | api video upload url | `client/src/chat/mediaSenders.ts` (2) |
| `/api/post_video_upload_url` | POST | `api_post_video_upload_url` | `backend/blueprints/media_assets.py:122` | api post video upload url | `client/src/pages/CreatePost.tsx` (1) |
| `/api/cron/media/purge-retained-stories` | POST | `cron_purge_retained_story_media` | `backend/blueprints/media_assets.py:133` | cron purge retained story media | *(no exact string match — may use helpers)* |
| `/notifications` | GET (default) | `notifications_page` | `backend/blueprints/notifications.py:88` | notifications page | `client/src/pages/Notifications.tsx` (8), `client/src/components/NativePushInit.tsx` (5), `client/src/utils/pushNotificationPayload.test.ts` (4), `client/src/contexts/BadgeContext.tsx` (3), `client/src/pages/CommunityFeed.tsx` (3), `client/src/components/HeaderBar.tsx` (2), `client/src/components/StayLiquidBridge.tsx` (2), `client/src/pages/GroupFeed.tsx` (2) |
| `/api/notifications/check` | GET (default) | `check_new_notifications` | `backend/blueprints/notifications.py:107` | check new notifications | *(no exact string match — may use helpers)* |
| `/api/notifications/debug` | GET (default) | `debug_notifications` | `backend/blueprints/notifications.py:189` | debug notifications | *(no exact string match — may use helpers)* |
| `/api/notifications/test-create` | POST | `test_create_notification` | `backend/blueprints/notifications.py:276` | test create notification | *(no exact string match — may use helpers)* |
| `/api/notifications/fix-schema` | POST | `fix_notifications_schema` | `backend/blueprints/notifications.py:329` | fix notifications schema | *(no exact string match — may use helpers)* |
| `/api/notifications` | GET (default) | `get_notifications` | `backend/blueprints/notifications.py:452` | get notifications | `client/src/pages/Notifications.tsx` (7), `client/src/components/NativePushInit.tsx` (4), `client/src/contexts/BadgeContext.tsx` (3), `client/src/pages/CommunityFeed.tsx` (2), `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/notifications/<int:notification_id>/read` | POST | `mark_notification_read` | `backend/blueprints/notifications.py:676` | mark notification read | *(no exact string match — may use helpers)* |
| `/api/notifications/<int:notification_id>` | DELETE | `delete_notification` | `backend/blueprints/notifications.py:704` | delete notification | *(no exact string match — may use helpers)* |
| `/api/notifications/mark-community-read` | POST | `mark_community_notifications_read` | `backend/blueprints/notifications.py:748` | mark community notifications read | `client/src/pages/CommunityFeed.tsx` (1) |
| `/api/notifications/mark-all-read` | POST | `mark_all_notifications_read` | `backend/blueprints/notifications.py:780` | mark all notifications read | `client/src/pages/Notifications.tsx` (2) |
| `/api/notifications/delete-read` | POST | `delete_read_notifications` | `backend/blueprints/notifications.py:813` | delete read notifications | `client/src/pages/Notifications.tsx` (1) |
| `/api/notifications/badge-count` | GET | `get_badge_count` | `backend/blueprints/notifications.py:846` | get badge count | *(no exact string match — may use helpers)* |
| `/api/notifications/badge-debug` | GET | `debug_badge_count` | `backend/blueprints/notifications.py:860` | debug badge count | *(no exact string match — may use helpers)* |
| `/api/notifications/clear-badge` | POST | `clear_notification_badge` | `backend/blueprints/notifications.py:944` | clear notification badge | `client/src/components/NativePushInit.tsx` (4), `client/src/contexts/BadgeContext.tsx` (2) |
| `/api/admin/cleanup_duplicate_tokens` | POST | `cleanup_duplicate_tokens` | `backend/blueprints/notifications.py:968` | cleanup duplicate tokens | *(no exact string match — may use helpers)* |
| `/api/admin/broadcast_notification` | POST | `admin_broadcast_notification` | `backend/blueprints/notifications.py:1064` | admin broadcast notification | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Broadcast.tsx` (1) |
| `/api/poll_notification_check` | POST | `api_poll_notification_check` | `backend/blueprints/notifications.py:1173` | api poll notification check | *(no exact string match — may use helpers)* |
| `/api/event_notification_check` | POST | `api_event_notification_check` | `backend/blueprints/notifications.py:1246` | api event notification check | *(no exact string match — may use helpers)* |
| `/api/cron/events/reminders` | POST | `api_event_notification_check` | `backend/blueprints/notifications.py:1247` | api event notification check | *(no exact string match — may use helpers)* |
| `/api/cron/steve/reminder-vault-dispatch` | POST | `api_cron_steve_reminder_vault_dispatch` | `backend/blueprints/notifications.py:1316` | api cron steve reminder vault dispatch | *(no exact string match — may use helpers)* |
| `/onboarding` | GET (default) | `onboarding_react` | `backend/blueprints/onboarding.py:131` | onboarding react | `client/src/pages/OnboardingChat.tsx` (17), `client/src/App.tsx` (4), `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (4), `client/src/pages/PremiumDashboard.tsx` (3), `client/src/components/onboarding/OnboardingIntroGate.tsx` (3), `client/src/i18n/index.ts` (2), `client/src/pages/Profile.tsx` (2), `client/src/i18n/onboardingChatHelpers.ts` (1) |
| `/debug_onboarding` | GET (default) | `debug_onboarding` | `backend/blueprints/onboarding.py:158` | debug onboarding | *(no exact string match — may use helpers)* |
| `/clear_onboarding_storage` | GET, POST | `clear_onboarding_storage` | `backend/blueprints/onboarding.py:373` | clear onboarding storage | *(no exact string match — may use helpers)* |
| `/onboarding/welcome` | GET (default) | `onboarding_welcome` | `backend/blueprints/onboarding.py:422` | onboarding welcome | *(no exact string match — may use helpers)* |
| `/api/onboarding/state` | GET | `get_onboarding_state` | `backend/blueprints/onboarding.py:452` | get onboarding state | `client/src/pages/OnboardingChat.tsx` (4), `client/src/pages/PremiumDashboard.tsx` (2), `client/src/pages/CommunityFeed.tsx` (1) |
| `/api/onboarding/state` | POST | `save_onboarding_state` | `backend/blueprints/onboarding.py:513` | save onboarding state | `client/src/pages/OnboardingChat.tsx` (4), `client/src/pages/PremiumDashboard.tsx` (2), `client/src/pages/CommunityFeed.tsx` (1) |
| `/api/onboarding/defer_profile` | POST | `onboarding_defer_profile` | `backend/blueprints/onboarding.py:546` | onboarding defer profile | `client/src/components/onboarding/OnboardingIntroGate.test.tsx` (2), `client/src/pages/OnboardingChat.tsx` (1), `client/src/components/onboarding/OnboardingIntroGate.tsx` (1) |
| `/api/cron/onboarding/reminders` | POST | `onboarding_reminders_cron` | `backend/blueprints/onboarding.py:577` | onboarding reminders cron | *(no exact string match — may use helpers)* |
| `/api/onboarding/tier_hints` | GET | `onboarding_tier_hints` | `backend/blueprints/onboarding.py:594` | onboarding tier hints | `client/src/i18n/onboardingChatHelpers.ts` (1), `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/bootstrap_communities` | POST | `onboarding_bootstrap_communities` | `backend/blueprints/onboarding.py:607` | onboarding bootstrap communities | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/redirect` | POST | `onboarding_redirect_message` | `backend/blueprints/onboarding.py:633` | onboarding redirect message | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/resolve_role` | POST | `onboarding_resolve_role` | `backend/blueprints/onboarding.py:673` | onboarding resolve role | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/resolve_location` | POST | `onboarding_resolve_location` | `backend/blueprints/onboarding.py:719` | onboarding resolve location | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/compose_bio` | POST | `onboarding_compose_bio` | `backend/blueprints/onboarding.py:799` | onboarding compose bio | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/enrich` | POST | `onboarding_enrich_profile` | `backend/blueprints/onboarding.py:1072` | onboarding enrich profile | *(no exact string match — may use helpers)* |
| `/api/onboarding/save_field` | POST | `onboarding_save_field` | `backend/blueprints/onboarding.py:1262` | onboarding save field | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/parse_cv` | POST | `onboarding_parse_cv` | `backend/blueprints/onboarding.py:1319` | onboarding parse cv | `client/src/pages/OnboardingChat.tsx` (1), `client/src/pages/Profile.tsx` (1) |
| `/api/onboarding/apply_professional_structured` | POST | `onboarding_apply_professional_structured` | `backend/blueprints/onboarding.py:1428` | onboarding apply professional structured | `client/src/pages/OnboardingChat.tsx` (1), `client/src/pages/Profile.tsx` (1) |
| `/api/onboarding/social_links` | POST | `onboarding_save_social_links` | `backend/blueprints/onboarding.py:1540` | onboarding save social links | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/onboarding/complete` | POST | `onboarding_complete` | `backend/blueprints/onboarding.py:1557` | onboarding complete | `client/src/pages/OnboardingChat.tsx` (1) |
| `/api/me/platform-activity-digest` | GET | `api_platform_activity_digest` | `backend/blueprints/platform_activity.py:34` | api platform activity digest | *(no exact string match — may use helpers)* |
| `/api/post_view` | POST | `api_post_view` | `backend/blueprints/post_views.py:28` | api post view | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/HomeTimeline.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/` | GET | `index` | `backend/blueprints/public.py:23` | index | *(no exact string match — may use helpers)* |
| `/welcome` | GET | `welcome` | `backend/blueprints/public.py:50` | welcome | `client/src/App.tsx` (3), `client/src/pages/InvitePreview.tsx` (2), `client/src/pages/AdminDashboard.tsx` (1), `client/src/pages/OnboardingWelcome.tsx` (1), `admin-web/src/pages/Settings.tsx` (1) |
| `/api/push/register_fcm` | POST | `register_fcm_token` | `backend/blueprints/public.py:77` | register fcm token | `client/src/components/NativePushInit.tsx` (1), `client/src/components/PushInit.tsx` (1) |
| `/api/push/unregister_fcm` | POST | `unregister_fcm_token` | `backend/blueprints/public.py:162` | unregister fcm token | `client/src/utils/logout.test.ts` (2), `client/src/utils/logout.ts` (1) |
| `/api/push/register_native` | POST | `register_native_push_token` | `backend/blueprints/public.py:247` | register native push token | *(no exact string match — may use helpers)* |
| `/api/push/public_key` | GET | `get_push_public_key` | `backend/blueprints/public.py:324` | get push public key | `client/src/components/PushInit.tsx` (1) |
| `/api/steve/chat/preflight` | GET | `steve_chat_preflight` | `backend/blueprints/steve_chat.py:32` | steve chat preflight | *(no exact string match — may use helpers)* |
| `/api/steve/feedback` | POST | `create_steve_feedback` | `backend/blueprints/steve_feedback.py:42` | create steve feedback | *(no exact string match — may use helpers)* |
| `/api/admin/steve_feedback` | GET | `admin_list_steve_feedback` | `backend/blueprints/steve_feedback.py:68` | admin list steve feedback | `client/src/pages/AdminDashboard.tsx` (4) |
| `/api/admin/steve_feedback/<int:feedback_id>` | GET | `admin_get_steve_feedback` | `backend/blueprints/steve_feedback.py:85` | admin get steve feedback | *(no exact string match — may use helpers)* |
| `/api/admin/steve_feedback/<int:feedback_id>` | PATCH | `admin_update_steve_feedback` | `backend/blueprints/steve_feedback.py:98` | admin update steve feedback | *(no exact string match — may use helpers)* |
| `/api/admin/steve_feedback/<int:feedback_id>/notes` | POST | `admin_add_steve_feedback_note` | `backend/blueprints/steve_feedback.py:120` | admin add steve feedback note | *(no exact string match — may use helpers)* |
| `/api/admin/steve_feedback/<int:feedback_id>/closure_receipt` | POST | `admin_send_steve_feedback_closure_receipt` | `backend/blueprints/steve_feedback.py:139` | admin send steve feedback closure receipt | *(no exact string match — may use helpers)* |
| `/api/me/steve/reminders` | GET | `api_list_reminders` | `backend/blueprints/steve_reminders.py:34` | api list reminders | `client/src/pages/ChatThread.tsx` (3) |
| `/api/me/steve/reminders/<int:rid>` | DELETE | `api_delete_reminder` | `backend/blueprints/steve_reminders.py:49` | api delete reminder | *(no exact string match — may use helpers)* |
| `/api/me/steve/reminders/<int:rid>` | PATCH | `api_patch_reminder` | `backend/blueprints/steve_reminders.py:73` | api patch reminder | *(no exact string match — may use helpers)* |
| `/api/webhooks/stripe` | POST | `stripe_webhook` | `backend/blueprints/subscription_webhooks.py:92` | stripe webhook | *(no exact string match — may use helpers)* |
| `/api/webhooks/apple` | POST | `apple_webhook` | `backend/blueprints/subscription_webhooks.py:860` | apple webhook | *(no exact string match — may use helpers)* |
| `/api/webhooks/google` | POST | `google_webhook` | `backend/blueprints/subscription_webhooks.py:943` | google webhook | *(no exact string match — may use helpers)* |
| `/api/stripe/config` | GET | `api_stripe_config` | `backend/blueprints/subscriptions.py:246` | api stripe config | *(no exact string match — may use helpers)* |
| `/api/me/subscriptions` | GET | `api_me_subscriptions` | `backend/blueprints/subscriptions.py:257` | api me subscriptions | `client/src/pages/SubscriptionPlans.test.tsx` (6), `client/src/pages/Communities.tsx` (1), `client/src/pages/SubscriptionPlans.tsx` (1), `client/src/components/membership/PaidCommunitiesBillingSection.tsx` (1), `client/src/components/subscriptions/StevePickerPanel.tsx` (1) |
| `/api/kb/pricing` | GET | `api_kb_pricing` | `backend/blueprints/subscriptions.py:423` | api kb pricing | `client/src/pages/SubscriptionPlans.test.tsx` (6), `client/src/pages/SubscriptionPlans.tsx` (1) |
| `/api/communities/<int:community_id>/billing` | GET | `api_community_billing` | `backend/blueprints/subscriptions.py:962` | api community billing | *(no exact string match — may use helpers)* |
| `/api/communities/<int:community_id>/billing/change-tier` | POST | `api_community_billing_change_tier` | `backend/blueprints/subscriptions.py:1084` | api community billing change tier | *(no exact string match — may use helpers)* |
| `/api/admin/communities/<int:community_id>/billing/change-tier` | POST | `api_admin_community_billing_change_tier` | `backend/blueprints/subscriptions.py:1216` | api admin community billing change tier | *(no exact string match — may use helpers)* |
| `/api/admin/communities/<int:community_id>/billing/sync-stripe-renewal` | POST | `api_admin_community_billing_sync_stripe_renewal` | `backend/blueprints/subscriptions.py:1350` | api admin community billing sync stripe renewal | *(no exact string match — may use helpers)* |
| `/api/stripe/checkout_status` | GET | `api_stripe_checkout_status` | `backend/blueprints/subscriptions.py:1384` | api stripe checkout status | `client/src/pages/Success.tsx` (2) |
| `/api/stripe/create_checkout_session` | POST | `api_stripe_create_checkout_session` | `backend/blueprints/subscriptions.py:1477` | api stripe create checkout session | `client/src/pages/SubscriptionPlans.test.tsx` (1), `client/src/pages/SubscriptionPlans.tsx` (1) |
| `/api/summaries/voice/preflight` | POST | `voice_summary_preflight` | `backend/blueprints/summaries.py:31` | voice summary preflight | *(no exact string match — may use helpers)* |
| `/api/post/<int:post_id>/summary` | GET | `post_summary` | `backend/blueprints/summaries.py:82` | post summary | *(no exact string match — may use helpers)* |
| `/api/post_summary/config` | GET | `post_summary_config` | `backend/blueprints/summaries.py:95` | post summary config | `client/src/components/steve/useSteveSummaryConfig.ts` (1) |
| `/get_links` | GET (default) | `get_links` | `backend/blueprints/useful_resources.py:41` | get links | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/UsefulLinks.tsx` (1) |
| `/add_link` | POST | `add_link` | `backend/blueprints/useful_resources.py:61` | add link | `client/src/pages/UsefulLinks.tsx` (1) |
| `/upload_doc` | POST | `upload_doc` | `backend/blueprints/useful_resources.py:91` | upload doc | `client/src/pages/UsefulLinks.tsx` (1) |
| `/delete_doc` | POST | `delete_doc` | `backend/blueprints/useful_resources.py:124` | delete doc | `client/src/pages/UsefulLinks.tsx` (1) |
| `/rename_doc` | POST | `rename_doc` | `backend/blueprints/useful_resources.py:148` | rename doc | `client/src/pages/UsefulLinks.tsx` (1) |
| `/delete_link` | POST | `delete_link` | `backend/blueprints/useful_resources.py:173` | delete link | `client/src/pages/UsefulLinks.tsx` (1) |

---

## Monolith (`bodybuilding_app.py`)

Total **373** `@app.route` registrations, grouped below for readability.

### `/api/account`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/account/notification_preferences` | POST | `api_account_notification_preferences` | 11456 | api account notification preferences | `client/src/pages/AccountSettings.tsx` (1) |
| `/api/account/timezone` | POST | `api_account_timezone` | 11422 | api account timezone | `client/src/utils/deviceTimezone.ts` (1) |

### `/api/admin`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/admin/add_user` | POST | `admin_add_user` | 9703 | admin add user | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Users.tsx` (1) |
| `/api/admin/add_user_to_community` | POST | `admin_add_user_to_community_api` | 9837 | admin add user to community api | — |
| `/api/admin/all_blocked_users` | GET | `admin_get_all_blocked_users` | 19496 | admin get all blocked users | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Blocked.tsx` (1) |
| `/api/admin/communities` | GET | `admin_communities_api` | 9236 | admin communities api | `admin-web/src/pages/CommunitiesDirectory.tsx` (2), `admin-web/src/pages/Broadcast.tsx` (1), `admin-web/src/pages/ContentGeneration.tsx` (1), `admin-web/src/pages/Invites.tsx` (1), `admin-web/src/pages/Subscriptions.tsx` (1) |
| `/api/admin/communities_list` | GET | `admin_communities_list_api` | 9002 | admin communities list api | `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/api/admin/compress_images` | POST | `admin_compress_images` | 9745 | admin compress images | — |
| `/api/admin/dashboard` | GET | `admin_dashboard_api` | 9454 | admin dashboard api | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/NetworkInsights.tsx` (1) |
| `/api/admin/delete_reported_post` | POST | `admin_delete_reported_post` | 19246 | admin delete reported post | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Reports.tsx` (1) |
| `/api/admin/embeddings/backfill` | POST | `admin_embeddings_backfill` | 32089 | admin embeddings backfill | `client/src/pages/AdminDashboard.tsx` (2) |
| `/api/admin/embeddings/status` | GET | `admin_embeddings_status` | 32145 | admin embeddings status | `client/src/pages/AdminDashboard.tsx` (1) |
| `/api/admin/get_user_exercises` | GET | `admin_get_user_exercises` | 30537 | admin get user exercises | — |
| `/api/admin/knowledge_base/<target_username>` | GET | `admin_knowledge_base_get` | 6727 | admin knowledge base get | — |
| `/api/admin/knowledge_base/<target_username>/feedback` | POST | `admin_knowledge_base_feedback` | 6784 | admin knowledge base feedback | — |
| `/api/admin/knowledge_base/<target_username>/reset` | mixed | `admin_knowledge_base_reset` | 6926 | admin knowledge base reset | — |
| `/api/admin/knowledge_base/<target_username>/synthesize` | POST | `admin_knowledge_base_synthesize` | 6743 | admin knowledge base synthesize | — |
| `/api/admin/knowledge_base/graph/<target_username>` | GET | `admin_knowledge_base_graph` | 6945 | admin knowledge base graph | — |
| `/api/admin/knowledge_base/network/<int:network_id>/insights` | POST | `admin_network_insights` | 32517 | admin network insights | — |
| `/api/admin/knowledge_base/network/<int:network_id>/synthesize` | POST | `admin_network_knowledge_base_synthesize` | 6766 | admin network knowledge base synthesize | — |
| `/api/admin/knowledge_base/shared_nodes` | GET | `admin_knowledge_base_shared_nodes` | 6994 | admin knowledge base shared nodes | — |
| `/api/admin/legacy_user_exercises` | GET | `admin_legacy_user_exercises` | 30639 | admin legacy user exercises | — |
| `/api/admin/login-by-email` | POST | `admin_login_by_email` | 9259 | admin login by email | `admin-web/src/pages/FindAdmin.tsx` (1) |
| `/api/admin/merge_legacy_user_exercises` | POST | `admin_merge_legacy_user_exercises` | 30686 | admin merge legacy user exercises | — |
| `/api/admin/metrics` | GET | `admin_metrics_api` | 9437 | admin metrics api | `admin-web/src/pages/Metrics.tsx` (2), `client/src/pages/AdminDashboard.tsx` (1) |
| `/api/admin/networking/compute_outcomes` | POST | `admin_compute_networking_outcomes` | 32424 | admin compute networking outcomes | — |
| `/api/admin/networking/health` | GET | `admin_networking_health` | 32189 | admin networking health | — |
| `/api/admin/overview` | GET | `admin_overview_api` | 9314 | admin overview api | `admin-web/src/components/Layout.tsx` (1), `admin-web/src/pages/Overview.tsx` (1) |
| `/api/admin/profile` | GET | `admin_profile_api` | 9587 | admin profile api | `client/src/pages/AdminProfile.tsx` (1) |
| `/api/admin/reported_posts` | GET | `admin_get_reported_posts` | 19143 | admin get reported posts | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Reports.tsx` (1) |
| `/api/admin/review_report` | POST | `admin_review_report` | 19201 | admin review report | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Reports.tsx` (1) |
| `/api/admin/set_parent` | POST | `admin_set_parent` | 30583 | admin set parent | — |
| `/api/admin/steve_profiles` | GET | `admin_steve_profiles` | 6307 | admin steve profiles | `client/src/pages/AdminDashboard.tsx` (8), `admin-web/src/pages/UserProfiles.tsx` (3) |
| `/api/admin/steve_profiles/<target_username>/analysis` | mixed | `admin_steve_profile_delete` | 6551 | admin steve profile delete | — |
| `/api/admin/steve_profiles/<target_username>/analysis/sections` | mixed | `admin_steve_profile_patch` | 6647 | admin steve profile patch | — |
| `/api/admin/steve_profiles/<target_username>/analyze` | POST | `admin_steve_profile_analyze` | 6514 | admin steve profile analyze | — |
| `/api/admin/steve_profiles/<target_username>/edit` | POST | `admin_steve_profile_edit` | 6811 | admin steve profile edit | — |
| `/api/admin/steve_profiles/<target_username>/feedback` | mixed | `admin_steve_profile_feedback` | 6681 | admin steve profile feedback | — |
| `/api/admin/steve_profiles/<target_username>/wrong_person` | POST | `admin_steve_profile_wrong_person` | 6571 | admin steve profile wrong person | — |
| `/api/admin/steve_profiles/refresh_stale` | POST | `admin_steve_profiles_refresh_stale` | 32351 | admin steve profiles refresh stale | `client/src/pages/AdminDashboard.tsx` (1) |
| `/api/admin/tenants` | GET | `admin_list_tenants` | 9032 | admin list tenants | `admin-web/src/pages/Tenants.tsx` (7) |
| `/api/admin/tenants` | POST | `admin_create_tenant` | 9074 | admin create tenant | `admin-web/src/pages/Tenants.tsx` (7) |
| `/api/admin/tenants/<int:tenant_id>` | mixed | `admin_update_tenant` | 9111 | admin update tenant | — |
| `/api/admin/tenants/<int:tenant_id>/assign-communities` | mixed | `admin_assign_tenant_communities` | 9211 | admin assign tenant communities | — |
| `/api/admin/tenants/<int:tenant_id>/assign-users` | mixed | `admin_assign_tenant_users` | 9185 | admin assign tenant users | — |
| `/api/admin/tenants/<int:tenant_id>/communities` | GET | `admin_tenant_communities` | 9164 | admin tenant communities | — |
| `/api/admin/tenants/<int:tenant_id>/users` | GET | `admin_tenant_users` | 9143 | admin tenant users | — |
| `/api/admin/unblock_user` | POST | `admin_unblock_user` | 19559 | admin unblock user | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Blocked.tsx` (1) |
| `/api/admin/update_community` | POST | `admin_update_community` | 9675 | admin update community | — |
| `/api/admin/update_user` | POST | `admin_update_user` | 9646 | admin update user | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Users.tsx` (1) |
| `/api/admin/users` | GET | `admin_users_api` | 9351 | admin users api | `admin-web/src/pages/Users.tsx` (5), `admin-web/src/pages/Tenants.tsx` (1) |

### `/api/ai`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/ai/personalities` | GET | `get_ai_personalities` | 20955 | get ai personalities | `client/src/pages/EditCommunity.tsx` (1), `client/src/components/community/CommunityOwnerSetupIntro.tsx` (1) |
| `/api/ai/steve_preflight` | POST | `ai_steve_preflight` | 21026 | ai steve preflight | `client/src/utils/stevePreflight.test.ts` (1), `client/src/utils/stevePreflight.ts` (1) |
| `/api/ai/steve_reply` | POST | `ai_steve_reply` | 21660 | ai steve reply | `client/src/pages/CommentReply.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/all_active_polls`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/all_active_polls` | GET | `api_all_active_polls` | 14793 | api all active polls | `client/src/pages/Notifications.tsx` (1) |

### `/api/all_communities_debug`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/all_communities_debug` | GET | `get_all_communities_debug` | 26337 | get all communities debug | — |

### `/api/all_my_tasks`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/all_my_tasks` | GET | `api_all_my_tasks` | 14747 | api all my tasks | `client/src/pages/Notifications.tsx` (1) |

### `/api/block_user`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/block_user` | POST | `block_user` | 19307 | block user | `client/src/pages/ChatThread.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/blocked_users`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/blocked_users` | GET | `get_blocked_users` | 19427 | get blocked users | `client/src/pages/AccountSecurity.tsx` (1), `client/src/components/settings/PrivacySecurityPanel.tsx` (1) |

### `/api/check_admin`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/check_admin` | GET | `check_admin` | 6299 | check admin | `client/src/pages/AboutCPoint.tsx` (1), `client/src/pages/AdminDashboard.tsx` (1), `client/src/pages/AdminProfile.tsx` (1), `client/src/pages/Communities.tsx` (1), `client/src/pages/Networking.tsx` (1) |

### `/api/check_gym_membership`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/check_gym_membership` | GET | `check_gym_membership` | 26179 | check gym membership | `client/src/pages/PremiumDashboard.tsx` (1), `client/src/pages/YourSports.tsx` (1) |

### `/api/client_log`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/client_log` | POST | `api_client_log` | 5648 | api client log | `client/src/pages/PremiumDashboard.tsx` (2), `client/src/pages/OnboardingWelcome.tsx` (1) |

### `/api/community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community/<int:community_id>/ai_personality` | POST | `community_ai_personality` | 20965 | community ai personality | — |
| `/api/community/mute` | POST | `mute_community` | 24062 | mute community | `client/src/pages/CommunityFeed.tsx` (2) |
| `/api/community/mute_status` | GET | `community_mute_status` | 24097 | community mute status | `client/src/pages/CommunityFeed.tsx` (1) |

### `/api/community_feed`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_feed/<int:community_id>` | GET | `api_community_feed` | 24390 | api community feed | — |

### `/api/community_key_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_key_posts` | GET | `api_community_key_posts` | 25037 | api community key posts | `client/src/pages/KeyPosts.tsx` (1) |

### `/api/community_member_suggest`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_member_suggest` | GET | `api_community_member_suggest` | 24866 | api community member suggest | `client/src/components/MentionTextarea.tsx` (1) |

### `/api/community_photos`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_photos` | GET | `api_community_photos` | 5667 | api community photos | `client/src/pages/CommunityPhotos.tsx` (1) |

### `/api/community_posts_search`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_posts_search` | GET | `api_community_posts_search` | 5815 | api community posts search | `client/src/pages/CommunityFeed.tsx` (1) |

### `/api/community_tasks`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/community_tasks` | GET | `api_community_tasks` | 14677 | api community tasks | `client/src/pages/CommunityTasks.tsx` (3) |

### `/api/complete_task`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/complete_task` | POST | `api_complete_task` | 15113 | api complete task | `client/src/pages/CommunityTasks.tsx` (1) |

### `/api/config`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/config/giphy_key` | GET | `api_config_giphy_key` | 713 | api config giphy key | `client/src/components/GifPicker.tsx` (1) |

### `/api/create_task`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/create_task` | POST | `api_create_task` | 14869 | api create task | `client/src/pages/CommunityTasks.tsx` (1) |

### `/api/cron`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/cron/group-steve-agent-due` | POST | `cron_group_steve_agent_due` | 21604 | cron group steve agent due | — |
| `/api/cron/kb/weekly-synthesis` | POST | `cron_kb_weekly_synthesis` | 32252 | cron kb weekly synthesis | — |

### `/api/dashboard_communities_test`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/dashboard_communities_test` | GET | `dashboard_communities_test` | 26246 | dashboard communities test | — |

### `/api/debug_communities`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/debug_communities` | GET | `debug_communities` | 8937 | debug communities | — |

### `/api/debug_image_paths`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/debug_image_paths` | GET | `api_debug_image_paths` | 26009 | api debug image paths | — |

### `/api/delete_task`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/delete_task` | POST | `api_delete_task` | 15225 | api delete task | `client/src/pages/CommunityTasks.tsx` (1) |

### `/api/edit_task`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/edit_task` | POST | `api_edit_task` | 15160 | api edit task | — |

### `/api/email_verified_status`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/email_verified_status` | POST | `api_email_verified_status` | 11068 | api email verified status | `client/src/pages/Signup.tsx` (1) |

### `/api/follow`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/follow/<username>` | POST | `api_follow_toggle` | 10108 | api follow toggle | — |

### `/api/follow_requests`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/follow_requests/<username>` | mixed | `api_follow_request_decline` | 10702 | api follow request decline | — |
| `/api/follow_requests/<username>/accept` | POST | `api_follow_request_accept` | 10606 | api follow request accept | — |

### `/api/followers`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/followers` | GET | `api_followers_list` | 10248 | api followers list | `client/src/pages/Followers.tsx` (2) |

### `/api/followers_feed`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/followers_feed` | GET | `api_followers_feed` | 10369 | api followers feed | `client/src/pages/Followers.tsx` (1) |

### `/api/geo`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/geo/cities` | GET | `api_geo_cities` | 11496 | api geo cities | `client/src/pages/Profile.tsx` (1) |
| `/api/geo/countries` | GET | `api_geo_countries` | 11485 | api geo countries | `client/src/App.tsx` (1), `client/src/pages/Profile.tsx` (1) |

### `/api/geocode`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/geocode/reverse` | GET | `api_geocode_reverse` | 11509 | api geocode reverse | — |

### `/api/get_user_id_by_username`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/get_user_id_by_username` | POST | `api_get_user_id_by_username` | 31491 | api get user id by username | `client/src/pages/ChatThread.tsx` (2), `client/src/pages/CommunityFeed.tsx` (1) |

### `/api/get_user_profile_brief`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/get_user_profile_brief` | GET | `api_get_user_profile_brief` | 31515 | api get user profile brief | `client/src/pages/ChatThread.tsx` (1) |

### `/api/giphy`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/giphy/search` | GET | `api_giphy_search` | 680 | api giphy search | `client/src/components/GifPicker.tsx` (1) |

### `/api/group_members`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/group_members/<int:group_id>` | GET | `api_group_members_list` | 28022 | api group members list | — |
| `/api/group_members/<int:group_id>/add` | POST | `api_group_members_add` | 28145 | api group members add | — |
| `/api/group_members/<int:group_id>/available` | GET | `api_group_members_available` | 28098 | api group members available | — |
| `/api/group_members/<int:group_id>/remove` | POST | `api_group_members_remove` | 28189 | api group members remove | — |
| `/api/group_members/<int:group_id>/set_role` | POST | `api_group_members_set_role` | 28227 | api group members set role | — |

### `/api/group_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/group_post` | GET | `api_group_post` | 27145 | api group post | `client/src/pages/PostDetail.tsx` (6), `client/src/pages/GroupFeed.tsx` (4), `client/src/pages/CreatePost.tsx` (1), `client/src/utils/pilotRoutePrefetch.ts` (1) |

### `/api/group_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/group_posts` | POST | `api_group_posts_create` | 27161 | api group posts create | `client/src/pages/GroupFeed.tsx` (4), `client/src/pages/PostDetail.tsx` (3), `client/src/pages/CreatePost.tsx` (1) |
| `/api/group_posts/delete` | POST | `api_group_posts_delete` | 27579 | api group posts delete | `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/group_posts/edit` | POST | `api_group_posts_edit` | 27516 | api group posts edit | `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |
| `/api/group_posts/react` | POST | `api_group_posts_react` | 27448 | api group posts react | `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/group_replies`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/group_replies` | POST | `api_group_replies_create` | 27625 | api group replies create | `client/src/pages/CommentReply.tsx` (5), `client/src/pages/PostDetail.tsx` (4) |
| `/api/group_replies/react` | POST | `api_group_replies_react` | 27852 | api group replies react | `client/src/pages/CommentReply.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/group_settings`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/group_settings/<int:group_id>` | GET | `api_group_settings_get` | 27939 | api group settings get | — |
| `/api/group_settings/<int:group_id>` | POST | `api_group_settings_update` | 27982 | api group settings update | — |

### `/api/groups`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/groups` | GET | `api_groups_list` | 26717 | api groups list | `client/src/pages/Communities.tsx` (8), `client/src/pages/EditGroup.tsx` (1), `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/Messages.tsx` (1) |
| `/api/groups/<int:group_id>/steve_agent` | mixed | `api_groups_steve_agent_patch` | 26912 | api groups steve agent patch | — |
| `/api/groups/available_count` | GET | `api_groups_available_count` | 27016 | api groups available count | — |
| `/api/groups/available_count_legacy_disabled` | GET | `api_groups_available_count_legacy` | 26547 | api groups available count legacy | — |
| `/api/groups/create` | POST | `api_groups_create` | 26588 | api groups create | `client/src/pages/Communities.tsx` (1) |
| `/api/groups/create_legacy_disabled` | POST | `api_groups_create_legacy` | 26397 | api groups create legacy | — |
| `/api/groups/delete` | POST | `api_groups_delete` | 26885 | api groups delete | `client/src/pages/Communities.tsx` (1), `client/src/pages/EditGroup.tsx` (1) |
| `/api/groups/join` | POST | `api_groups_join` | 26784 | api groups join | `client/src/pages/Communities.tsx` (2) |
| `/api/groups/join_legacy_disabled` | POST | `api_groups_join_legacy` | 26499 | api groups join legacy | — |
| `/api/groups/leave` | POST | `api_groups_leave` | 26860 | api groups leave | `client/src/pages/Communities.tsx` (1), `client/src/pages/GroupFeed.tsx` (1), `client/src/pages/Messages.tsx` (1) |
| `/api/groups/my` | GET | `api_groups_my` | 27059 | api groups my | `client/src/pages/Communities.tsx` (2) |

### `/api/groups_legacy_disabled`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/groups_legacy_disabled` | GET | `api_groups_list_legacy` | 26442 | api groups list legacy | — |

### `/api/hidden_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/hidden_posts` | GET | `get_hidden_posts` | 19077 | get hidden posts | `client/src/pages/AccountSecurity.tsx` (1), `client/src/components/settings/PrivacySecurityPanel.tsx` (1) |

### `/api/hide_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/hide_post` | POST | `hide_post` | 19037 | hide post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/home_timeline`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/home_timeline` | GET | `api_home_timeline_route` | 25820 | api home timeline route | `client/src/pages/EventDetail.tsx` (1), `client/src/pages/HomeTimeline.tsx` (1), `client/src/pages/MobileLogin.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/invitation`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/invitation/verify` | GET | `verify_invitation` | 23999 | verify invitation | `client/src/pages/MobileLogin.tsx` (2), `client/src/pages/Signup.tsx` (1) |

### `/api/is_blocked`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/is_blocked` | GET | `is_user_blocked` | 19463 | is user blocked | — |

### `/api/key_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/key_posts` | GET | `api_key_posts` | 25078 | api key posts | `client/src/pages/KeyPosts.tsx` (1) |

### `/api/link-preview`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/link-preview` | GET | `get_link_preview` | 12581 | get link preview | `client/src/components/LinkPreview.tsx` (1) |

### `/api/my_tasks`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/my_tasks` | GET | `api_my_tasks` | 14712 | api my tasks | `client/src/pages/CommunityTasks.tsx` (3) |

### `/api/native_push`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/native_push/claim` | POST | `api_native_push_claim` | 31764 | api native push claim | — |
| `/api/native_push/register` | POST | `api_native_push_register` | 31688 | api native push register | — |
| `/api/native_push/unregister` | POST | `api_native_push_unregister` | 31817 | api native push unregister | — |

### `/api/networking`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/networking/communities` | GET | `api_networking_communities` | 12642 | api networking communities | `client/src/pages/Networking.tsx` (1), `client/src/components/feed/AskSteveEntry.tsx` (1) |
| `/api/networking/community_members/<int:community_id>` | GET | `api_networking_community_members` | 12665 | api networking community members | — |
| `/api/networking/steve_auto_match` | POST | `api_networking_steve_auto_match` | 13435 | api networking steve auto match | `client/src/pages/Networking.tsx` (1) |
| `/api/networking/steve_feedback` | POST | `api_steve_feedback` | 13797 | api steve feedback | `client/src/pages/Networking.tsx` (1) |
| `/api/networking/steve_match` | POST | `api_networking_steve_match` | 12998 | api networking steve match | `client/src/pages/Networking.tsx` (1) |
| `/api/networking/steve_session` | POST | `api_steve_session_create` | 13729 | api steve session create | `client/src/pages/Networking.tsx` (7) |
| `/api/networking/steve_session/<int:session_id>` | mixed | `api_steve_session_delete` | 13776 | api steve session delete | — |
| `/api/networking/steve_session/<int:session_id>/message` | POST | `api_steve_session_add_message` | 13751 | api steve session add message | — |
| `/api/networking/steve_session/<int:session_id>/messages` | GET | `api_steve_session_messages` | 13678 | api steve session messages | — |
| `/api/networking/steve_sessions` | GET | `api_steve_sessions` | 13641 | api steve sessions | `client/src/pages/Networking.tsx` (1) |

### `/api/product_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_poll` | POST | `api_create_product_poll` | 25351 | api create product poll | — |

### `/api/product_poll_close`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_poll_close` | POST | `api_product_poll_close` | 25440 | api product poll close | — |

### `/api/product_poll_delete`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_poll_delete` | POST | `api_product_poll_delete` | 25459 | api product poll delete | — |

### `/api/product_poll_vote`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_poll_vote` | POST | `api_product_poll_vote` | 25392 | api product poll vote | — |

### `/api/product_polls`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_polls` | GET | `api_product_polls` | 25318 | api product polls | — |

### `/api/product_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_post` | POST | `api_create_product_post` | 25159 | api create product post | — |

### `/api/product_post_delete`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_post_delete` | POST | `api_delete_product_post` | 25233 | api delete product post | — |

### `/api/product_post_edit`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_post_edit` | POST | `api_edit_product_post` | 25206 | api edit product post | — |

### `/api/product_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_posts` | GET | `api_product_posts` | 25119 | api product posts | — |

### `/api/product_reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_reply` | POST | `api_create_product_reply` | 25185 | api create product reply | — |

### `/api/product_reply_delete`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_reply_delete` | POST | `api_delete_product_reply` | 25292 | api delete product reply | — |

### `/api/product_reply_edit`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/product_reply_edit` | POST | `api_edit_product_reply` | 25265 | api edit product reply | — |

### `/api/profile`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/profile/<username>` | GET | `api_public_profile` | 9889 | api public profile | — |
| `/api/profile/ai_review` | POST | `api_profile_ai_review` | 7051 | api profile ai review | `client/src/pages/SteveKnowsMe.tsx` (2) |
| `/api/profile/ai_suggestions` | GET | `api_profile_ai_suggestions` | 7011 | api profile ai suggestions | — |
| `/api/profile/cv` | GET | `api_profile_cv_download` | 11371 | api profile cv download | `client/src/pages/Profile.tsx` (1) |
| `/api/profile/steve_analysis` | GET | `api_profile_steve_analysis` | 7141 | api profile steve analysis | `client/src/pages/SteveKnowsMe.tsx` (1) |
| `/api/profile/steve_request_refresh` | POST | `api_profile_steve_request_refresh` | 7199 | api profile steve request refresh | `client/src/pages/SteveKnowsMe.tsx` (1) |

### `/api/profile_me`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/profile_me` | GET | `api_profile_me` | 11168 | api profile me | `client/src/pages/PremiumDashboard.tsx` (3), `client/src/App.tsx` (2), `client/src/pages/AccountSettings.tsx` (2), `client/src/pages/Communities.tsx` (2), `client/src/pages/OnboardingChat.tsx` (2) |

### `/api/public`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/public/logo` | GET | `api_public_logo` | 23749 | api public logo | `client/src/components/BrandLogo.tsx` (1) |

### `/api/push`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/push/public_key` | GET | `api_push_public_key` | 31605 | api push public key | `client/src/components/PushInit.tsx` (1) |
| `/api/push/status` | GET | `api_push_status` | 31656 | api push status | — |
| `/api/push/subscribe` | POST | `api_push_subscribe` | 31613 | api push subscribe | `client/src/components/PushInit.tsx` (2) |
| `/api/push/test` | POST | `api_push_test` | 32016 | api push test | — |
| `/api/push/unsubscribe_web` | POST | `api_push_unsubscribe_web` | 31634 | api push unsubscribe web | `client/src/utils/logout.ts` (1) |

### `/api/reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/reply/<int:reply_id>` | GET | `api_get_reply` | 22416 | api get reply | — |

### `/api/reply_view`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/reply_view` | POST | `api_reply_view` | 22281 | api reply view | `client/src/pages/CommentReply.tsx` (1) |

### `/api/report_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/report_post` | POST | `report_post` | 18926 | report post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/simple_test`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/simple_test` | GET | `simple_community_test` | 26215 | simple community test | — |

### `/api/steve`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/steve/reset_dm_context` | POST | `reset_steve_dm_context` | 12600 | reset steve dm context | `client/src/pages/ChatThread.tsx` (1) |

### `/api/test_sub_permissions`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/test_sub_permissions` | POST | `test_sub_permissions` | 22547 | test sub permissions | — |

### `/api/toggle_community_key_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/toggle_community_key_post` | POST | `api_toggle_community_key_post` | 24989 | api toggle community key post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/toggle_key_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/toggle_key_post` | POST | `api_toggle_key_post` | 24929 | api toggle key post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/api/typing`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/typing` | POST | `api_set_typing` | 31553 | api set typing | `client/src/pages/ChatThread.tsx` (3), `client/src/chat/useDmMessagePoll.ts` (1) |
| `/api/typing` | GET | `api_get_typing` | 31578 | api get typing | `client/src/pages/ChatThread.tsx` (3), `client/src/chat/useDmMessagePoll.ts` (1) |

### `/api/unblock_user`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/unblock_user` | POST | `unblock_user` | 19396 | unblock user | `client/src/pages/AccountSecurity.tsx` (1), `client/src/components/settings/PrivacySecurityPanel.tsx` (1) |

### `/api/unhide_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/api/unhide_post` | POST | `unhide_post` | 19116 | unhide post | `client/src/pages/AccountSecurity.tsx` (1), `client/src/components/settings/PrivacySecurityPanel.tsx` (1) |

### `/.well-known`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/.well-known/apple-app-site-association` | GET | `apple_app_site_association` | 25930 | apple app site association | — |

### `/account_settings`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/account_settings` | GET | `account_settings` | 11100 | account settings | `client/src/App.tsx` (4), `client/src/components/StayLiquidBridge.tsx` (2), `client/src/pages/AccountSettings.tsx` (2), `client/src/pages/PremiumDashboard.tsx` (2), `client/src/components/BurgerMenuDrawer.tsx` (1) |

### `/add_ad`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/add_ad/<int:community_id>` | POST | `add_ad` | 17519 | add ad | — |

### `/add_exercise`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/add_exercise` | POST | `add_exercise` | 28559 | add exercise | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/add_exercise_to_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/add_exercise_to_workout` | POST | `add_exercise_to_workout` | 30323 | add exercise to workout | — |

### `/add_reaction`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/add_reaction` | POST | `add_reaction` | 14283 | add reaction | `client/src/pages/Communities.tsx` (3), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/add_reply_reaction`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/add_reply_reaction` | POST | `add_reply_reaction` | 22236 | add reply reaction | `client/src/pages/CommunityFeed.tsx` (3), `client/src/pages/CommentReply.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/admin`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/admin` | POST | `admin` | 9876 | admin | `client/src/pages/AdminDashboard.tsx` (34), `admin-web/src/pages/ContentGeneration.tsx` (9), `admin-web/src/pages/Tenants.tsx` (9), `admin-web/src/pages/Users.tsx` (8), `client/src/components/KnowledgeBaseGraph.tsx` (6) |
| `/admin/ads_overview` | GET | `admin_ads_overview` | 18567 | admin ads overview | — |
| `/admin/communities_list` | GET | `admin_communities_list` | 19896 | admin communities list | `admin-web/src/pages/ContentGeneration.tsx` (1) |
| `/admin/deactivate_community/<int:community_id>` | POST | `deactivate_community` | 18449 | deactivate community | — |
| `/admin/deactivate_user/<username>` | POST | `deactivate_user` | 18415 | deactivate user | — |
| `/admin/get_invite_logo` | GET | `admin_get_invite_logo` | 20057 | admin get invite logo | `admin-web/src/pages/Settings.tsx` (1) |
| `/admin/grant_admin` | POST | `admin_grant_admin` | 15266 | admin grant admin | — |
| `/admin/regenerate_app_icons` | POST | `regenerate_app_icons` | 11672 | regenerate app icons | — |
| `/admin/remove_invite_logo` | POST | `admin_remove_invite_logo` | 20138 | admin remove invite logo | `admin-web/src/pages/Settings.tsx` (1) |
| `/admin/upload_invite_logo` | POST | `admin_upload_invite_logo` | 20084 | admin upload invite logo | `admin-web/src/pages/Settings.tsx` (1) |
| `/admin/upload_welcome_card` | POST | `admin_upload_welcome_card` | 20002 | admin upload welcome card | `client/src/pages/AdminDashboard.tsx` (1), `admin-web/src/pages/Settings.tsx` (1) |
| `/admin/user_statistics` | GET | `admin_user_statistics` | 18488 | admin user statistics | — |

### `/admin_dashboard`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/admin_dashboard` | GET | `admin_dashboard_react` | 5986 | admin dashboard react | `client/src/App.tsx` (2), `client/src/pages/AdminProfile.tsx` (1), `client/src/pages/Notifications.tsx` (1) |

### `/admin_profile`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/admin_profile` | GET | `admin_profile` | 5582 | admin profile | `client/src/App.tsx` (1), `client/src/components/BurgerMenuDrawer.tsx` (1), `client/src/components/HeaderBar.tsx` (1) |

### `/admin_profile_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/admin_profile_react` | GET | `admin_profile_react` | 6004 | admin profile react | `client/src/App.tsx` (1), `client/src/components/BurgerMenuDrawer.tsx` (1), `client/src/components/HeaderBar.tsx` (1) |

### `/apple-app-site-association`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/apple-app-site-association` | GET | `apple_app_site_association` | 25931 | apple app site association | — |

### `/apple-touch-icon.png`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/apple-touch-icon.png` | GET | `apple_touch_icon_route` | 11720 | apple touch icon route | `client/src/components/BrandAssetsInit.tsx` (1) |

### `/assets`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/assets/<path:filename>` | GET | `serve_assets` | 5910 | serve assets | — |

### `/audio_compat`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/audio_compat/<path:filename>` | GET | `serve_audio_compat` | 13900 | serve audio compat | — |

### `/business_login`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/business_login` | POST | `business_login` | 12293 | business login | — |

### `/business_logout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/business_logout` | GET | `business_logout` | 12299 | business logout | — |

### `/cf_add_entry`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/cf_add_entry` | POST | `cf_add_entry` | 28303 | cf add entry | `client/src/pages/Crossfit.tsx` (1), `client/src/pages/CrossfitExact.tsx` (1) |

### `/cf_compare_item_in_box`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/cf_compare_item_in_box` | GET | `cf_compare_item_in_box` | 28412 | cf compare item in box | `client/src/pages/Crossfit.tsx` (1), `client/src/pages/CrossfitExact.tsx` (1) |

### `/check_exercise_in_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/check_exercise_in_workout` | GET | `check_exercise_in_workout` | 29663 | check exercise in workout | — |

### `/check_profile_picture`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/check_profile_picture` | GET | `check_profile_picture` | 11760 | check profile picture | — |

### `/cleanup_missing_images`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/cleanup_missing_images` | GET | `cleanup_missing_images` | 31323 | cleanup missing images | — |

### `/close_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/close_poll` | POST | `close_poll` | 16372 | close poll | `client/src/pages/CommunityPolls.tsx` (1) |

### `/club`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/club/<int:club_id>/join` | POST | `join_club` | 18094 | join club | — |

### `/communities`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/communities` | GET | `communities` | 22540 | communities | `client/src/pages/CommunityFeed.tsx` (3), `client/src/pages/EditCommunity.tsx` (3), `client/src/pages/PremiumDashboard.tsx` (3), `client/src/components/pageTransition.test.ts` (2), `client/src/components/community/CommunityOwnerSetupIntro.tsx` (2) |

### `/community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/community/<int:community_id>/admins` | GET | `get_community_admins` | 17975 | get community admins | — |
| `/community/<int:community_id>/appoint_admin` | POST | `appoint_community_admin` | 17887 | appoint community admin | — |
| `/community/<int:community_id>/calendar_react` | GET | `community_calendar_react` | 25848 | community calendar react | — |
| `/community/<int:community_id>/clubs` | GET | `clubs_directory` | 17999 | clubs directory | — |
| `/community/<int:community_id>/clubs/create` | POST | `create_club` | 18046 | create club | — |
| `/community/<int:community_id>/event/<int:event_id>/rsvp` | GET | `event_rsvp_page` | 18307 | event rsvp page | — |
| `/community/<int:community_id>/feedback` | POST | `submit_feedback` | 18149 | submit feedback | — |
| `/community/<int:community_id>/feedback/view` | GET | `view_feedback` | 18381 | view feedback | — |
| `/community/<int:community_id>/members` | GET | `react_members_page` | 25918 | react members page | — |
| `/community/<int:community_id>/members/list` | GET | `get_community_members_list` | 18180 | get community members list | — |
| `/community/<int:community_id>/polls_react` | GET | `community_polls_react` | 25878 | community polls react | — |
| `/community/<int:community_id>/remove_admin` | POST | `remove_community_admin` | 17937 | remove community admin | — |
| `/community/<int:community_id>/resources` | GET | `community_resources` | 17673 | community resources | — |
| `/community/<int:community_id>/resources/create` | POST | `create_resource_post` | 17729 | create resource post | — |
| `/community/<int:community_id>/tasks_react` | GET | `community_tasks_react` | 25865 | community tasks react | — |

### `/community_feed`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/community_feed/<int:community_id>` | GET | `community_feed` | 24223 | community feed | — |

### `/community_feed_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/community_feed_react/<int:community_id>` | GET | `community_feed_react` | 25835 | community feed react | — |

### `/community_feed_smart`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/community_feed_smart/<int:community_id>` | GET | `community_feed_smart` | 24258 | community feed smart | — |

### `/compare_attendance_in_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/compare_attendance_in_community` | GET | `compare_attendance_in_community` | 29118 | compare attendance in community | — |

### `/compare_exercise_in_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/compare_exercise_in_community` | GET | `compare_exercise_in_community` | 28915 | compare exercise in community | — |

### `/compare_improvement_in_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/compare_improvement_in_community` | GET | `compare_improvement_in_community` | 29192 | compare improvement in community | — |

### `/compare_overview_in_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/compare_overview_in_community` | GET | `compare_overview_in_community` | 29040 | compare overview in community | — |

### `/create_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/create_community` | POST | `create_community` | 22605 | create community | `client/src/pages/Communities.tsx` (1), `client/src/pages/PremiumDashboard.tsx` (1) |

### `/create_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/create_poll` | POST | `create_poll` | 16180 | create poll | `client/src/pages/CommunityPolls.tsx` (1) |

### `/create_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/create_workout` | POST | `create_workout` | 30163 | create workout | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/crossfit`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/crossfit` | GET | `crossfit` | 28277 | crossfit | `client/src/App.tsx` (2), `client/src/pages/YourSports.tsx` (1) |

### `/crossfit_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/crossfit_react` | GET | `crossfit_react` | 28288 | crossfit react | `client/src/App.tsx` (1) |

### `/dashboard`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/dashboard` | GET | `dashboard` | 5594 | dashboard | `client/src/pages/PremiumDashboard.tsx` (4), `client/src/pages/AdminDashboard.tsx` (2), `client/src/components/pageTransitionUtils.ts` (1), `client/src/pages/Communities.tsx` (1), `client/src/pages/EditCommunity.tsx` (1) |

### `/debug`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/debug/message_photos` | GET | `debug_message_photos` | 14151 | debug message photos | — |
| `/debug/r2_status` | GET | `debug_r2_status` | 14087 | debug r2 status | — |

### `/debug_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/debug_community/<int:community_id>` | GET | `debug_community` | 23687 | debug community | — |

### `/debug_posts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/debug_posts` | GET | `debug_posts` | 23715 | debug posts | — |

### `/delete_ad`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_ad/<int:ad_id>` | POST | `delete_ad` | 17641 | delete ad | — |

### `/delete_community_announcement`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_community_announcement` | POST | `delete_community_announcement` | 31223 | delete community announcement | `client/src/pages/CommunityFeed.tsx` (1) |

### `/delete_community_file`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_community_file` | POST | `delete_community_file` | 30941 | delete community file | — |

### `/delete_exercise`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_exercise` | POST | `delete_exercise` | 28871 | delete exercise | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/delete_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_poll` | POST | `delete_poll` | 17021 | delete poll | `client/src/pages/CommunityFeed.tsx` (1) |

### `/delete_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_post` | POST | `delete_post` | 18810 | delete post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/delete_reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_reply` | POST | `delete_reply` | 20160 | delete reply | `client/src/pages/CommentReply.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/delete_set`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_set` | POST | `delete_set` | 29430 | delete set | — |

### `/delete_weight_entry`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_weight_entry` | POST | `delete_weight_entry` | 29467 | delete weight entry | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/delete_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/delete_workout` | POST | `delete_workout` | 30425 | delete workout | — |

### `/download_announcement_file`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/download_announcement_file/<int:file_id>` | GET | `download_announcement_file` | 31290 | download announcement file | — |

### `/download_community_file`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/download_community_file/<filename>` | GET | `download_community_file` | 30922 | download community file | — |

### `/edit_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_community` | POST | `edit_community` | 23212 | edit community | — |

### `/edit_exercise`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_exercise` | POST | `edit_exercise` | 28817 | edit exercise | — |

### `/edit_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_poll` | POST | `edit_poll` | 16494 | edit poll | `client/src/pages/CommunityPolls.tsx` (1) |

### `/edit_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_post` | POST | `edit_post` | 19602 | edit post | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/PostDetail.tsx` (1) |

### `/edit_profile`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_profile` | POST | `edit_profile` | 12238 | edit profile | — |

### `/edit_reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_reply` | POST | `edit_reply` | 25479 | edit reply | `client/src/pages/CommentReply.tsx` (2), `client/src/pages/PostDetail.tsx` (1) |

### `/edit_set`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/edit_set` | POST | `edit_set` | 29391 | edit set | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/favicon.svg`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/favicon.svg` | GET | `favicon` | 5878 | favicon | — |
| `/favicon.svg` | GET | `serve_favicon` | 25987 | serve favicon | — |

### `/feed`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/feed` | GET | `feed` | 14263 | feed | `client/src/components/pageTransition.test.ts` (8), `client/src/App.tsx` (4), `client/src/components/pageTransitionUtils.ts` (3), `client/src/components/DashboardBottomNav.tsx` (2), `client/src/pages/CommunityFeed.tsx` (2) |

### `/fix_database_issues`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/fix_database_issues` | GET | `fix_database_issues` | 23553 | fix database issues | — |

### `/followers`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/followers` | GET | `followers_page` | 5972 | followers page | `client/src/pages/Followers.tsx` (2), `client/src/pages/PremiumDashboard.tsx` (2), `client/src/utils/pushNotificationPayload.ts` (2), `client/src/App.tsx` (1), `client/src/components/BurgerMenuDrawer.tsx` (1) |

### `/get_active_chat_counts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_active_chat_counts` | GET | `get_active_chat_counts` | 32034 | get active chat counts | — |

### `/get_active_polls`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_active_polls` | GET | `get_active_polls` | 16964 | get active polls | `client/src/pages/CommunityPolls.tsx` (1) |

### `/get_available_parent_communities`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_available_parent_communities` | GET | `get_available_parent_communities` | 23010 | get available parent communities | `client/src/pages/EditCommunity.tsx` (1) |

### `/get_community_announcements`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_community_announcements` | GET | `get_community_announcements` | 31168 | get community announcements | `client/src/pages/CommunityFeed.tsx` (2) |

### `/get_community_files`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_community_files` | GET | `get_community_files` | 30890 | get community files | — |

### `/get_exercise_one_rm`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_exercise_one_rm` | GET | `get_exercise_one_rm` | 29585 | get exercise one rm | — |

### `/get_exercise_progress`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_exercise_progress` | GET | `get_exercise_progress` | 29514 | get exercise progress | — |

### `/get_historical_polls`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_historical_polls` | GET | `get_historical_polls` | 17117 | get historical polls | — |

### `/get_image_color`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_image_color` | GET | `get_image_color` | 18716 | get image color | — |

### `/get_individual_workout_summary`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_individual_workout_summary` | GET | `get_individual_workout_summary` | 30018 | get individual workout summary | — |

### `/get_logo`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_logo` | GET | `get_logo` | 15353 | get logo | — |

### `/get_poll_results`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_poll_results/<int:poll_id>` | GET | `get_poll_results` | 16760 | get poll results | — |

### `/get_poll_voters`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_poll_voters/<int:poll_id>` | GET | `get_poll_voters` | 16792 | get poll voters | — |

### `/get_post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_post` | GET | `get_post` | 22404 | get post | `client/src/pages/PostDetail.tsx` (4), `client/src/pages/CommunityFeed.tsx` (1), `client/src/utils/pilotRoutePrefetch.ts` (1) |

### `/get_post_reactors`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_post_reactors/<int:post_id>` | GET | `get_post_reactors` | 16846 | get post reactors | — |

### `/get_progress_summary`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_progress_summary` | GET | `get_progress_summary` | 29748 | get progress summary | — |

### `/get_reply_reactors`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_reply_reactors/<int:reply_id>` | GET | `get_reply_reactors` | 22308 | get reply reactors | — |

### `/get_university_ads`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_university_ads` | GET | `get_university_ads` | 17362 | get university ads | — |

### `/get_user_communities`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_user_communities` | GET | `get_user_communities` | 23164 | get user communities | `client/src/components/GroupChatCreator.tsx` (1), `client/src/components/ParentCommunityPicker.tsx` (1), `client/src/pages/Crossfit.tsx` (1), `client/src/pages/CrossfitExact.tsx` (1), `client/src/pages/Messages.tsx` (1) |

### `/get_user_communities_with_members`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_user_communities_with_members` | GET | `get_user_communities_with_members` | 23075 | get user communities with members | `client/src/pages/Messages.tsx` (1), `client/src/utils/serverPull.ts` (1) |

### `/get_user_exercises`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_user_exercises` | GET | `get_user_exercises` | 30474 | get user exercises | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/get_workout_details`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_workout_details` | GET | `get_workout_details` | 30265 | get workout details | — |

### `/get_workout_exercises`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_workout_exercises` | GET | `get_workout_exercises` | 28750 | get workout exercises | `client/src/pages/WorkoutTracking.tsx` (2) |

### `/get_workout_summary`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_workout_summary` | GET | `get_workout_summary` | 29821 | get workout summary | — |

### `/get_workouts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/get_workouts` | GET | `get_workouts` | 30228 | get workouts | `client/src/pages/WorkoutTracking.tsx` (2) |

### `/group`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/group/<int:group_id>/edit` | GET | `group_edit_react` | 27928 | group edit react | — |

### `/group_feed_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/group_feed_react/<int:group_id>` | GET | `group_feed_react` | 27917 | group feed react | — |

### `/gym`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/gym` | GET | `gym` | 18479 | gym | `client/src/App.tsx` (1) |

### `/gym_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/gym_react` | GET | `gym_react` | 28272 | gym react | — |

### `/health`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/health` | GET | `health_check` | 8907 | health check | — |

### `/home`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/home` | GET | `react_home_timeline_page` | 25825 | react home timeline page | `client/src/App.tsx` (1), `client/src/components/HeaderBar.tsx` (1), `client/src/components/StayLiquidBridge.tsx` (1), `client/src/pages/Communities.tsx` (1), `client/src/pages/EventDetail.tsx` (1) |

### `/icons`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/icons/<path:filename>` | GET | `icons` | 5901 | icons | — |
| `/icons/<path:filename>` | GET | `serve_generated_icons` | 11743 | serve generated icons | — |
| `/icons/<path:filename>` | GET | `serve_icons` | 25995 | serve icons | — |

### `/invite`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/invite/<token>` | GET | `invite_landing` | 23765 | invite landing | — |

### `/keep-warm`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/keep-warm` | POST | `keep_warm` | 8917 | keep warm | — |

### `/leaderboard_exercise_in_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/leaderboard_exercise_in_community` | GET | `leaderboard_exercise_in_community` | 28990 | leaderboard exercise in community | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/leave_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/leave_community` | POST | `leave_community` | 24118 | leave community | `client/src/pages/Communities.tsx` (2), `client/src/pages/Members.tsx` (1) |

### `/log_weight_set`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/log_weight_set` | POST | `log_weight_set` | 29286 | log weight set | `client/src/pages/WorkoutTracking.tsx` (1) |

### `/manage_ads`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/manage_ads/<int:community_id>` | GET | `manage_ads` | 17462 | manage ads | — |

### `/manifest.webmanifest`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/manifest.webmanifest` | GET | `manifest` | 5886 | manifest | — |
| `/manifest.webmanifest` | GET | `serve_manifest` | 25974 | serve manifest | — |

### `/migrate_parent_communities`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/migrate_parent_communities` | GET | `migrate_parent_communities` | 23493 | migrate parent communities | — |

### `/networking`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/networking` | GET | `networking_page` | 5957 | networking page | `client/src/pages/Networking.tsx` (20), `client/src/components/feed/AskSteveEntry.tsx` (2), `client/src/App.tsx` (1), `client/src/components/DashboardBottomNav.tsx` (1), `client/src/components/pageTransitionUtils.ts` (1) |

### `/post`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/post/<int:post_id>` | GET | `react_post_detail` | 25891 | react post detail | — |
| `/post/<int:post_id>/delete` | mixed | `delete_community_post` | 17856 | delete community post | — |

### `/post_reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/post_reply` | POST | `post_reply` | 15920 | post reply | `client/src/pages/PostDetail.tsx` (2), `client/src/pages/CommentReply.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1) |

### `/post_status`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/post_status` | POST | `post_status` | 15461 | post status | `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/CreatePost.tsx` (1) |

### `/premium_dashboard`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/premium_dashboard` | GET | `premium_dashboard` | 5600 | premium dashboard | `client/src/components/pageTransition.test.ts` (12), `client/src/pages/MobileLogin.tsx` (8), `client/src/components/DashboardBottomNav.tsx` (4), `client/src/App.tsx` (3), `client/src/components/StayLiquidBridge.tsx` (3) |

### `/premium_dashboard_react`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/premium_dashboard_react` | GET | `premium_dashboard_react` | 5943 | premium dashboard react | `client/src/App.tsx` (1), `client/src/components/DashboardBottomNav.tsx` (1), `client/src/components/pageTransitionUtils.ts` (1), `client/src/components/StayLiquidBridge.tsx` (1) |

### `/profile`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/profile` | GET | `profile` | 11135 | profile | `client/src/pages/Profile.tsx` (9), `client/src/pages/PremiumDashboard.tsx` (7), `client/src/App.tsx` (6), `client/src/pages/CommentReply.tsx` (5), `client/src/pages/SteveKnowsMe.tsx` (5) |
| `/profile/<username>` | GET | `public_profile` | 10749 | public profile | — |

### `/remove_exercise_from_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/remove_exercise_from_workout` | POST | `remove_exercise_from_workout` | 30377 | remove exercise from workout | — |

### `/remove_logo`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/remove_logo` | POST | `remove_logo` | 15385 | remove logo | — |

### `/remove_poll_option`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/remove_poll_option` | POST | `remove_poll_option` | 17060 | remove poll option | — |

### `/reply`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/reply/<int:reply_id>` | GET | `react_reply_detail` | 25904 | react reply detail | — |

### `/report_issue`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/report_issue` | POST | `report_issue` | 17175 | report issue | — |

### `/resend_verification`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/resend_verification` | POST | `resend_verification` | 10984 | resend verification | `client/src/components/VerifyOverlay.tsx` (1), `client/src/pages/AccountSettings.tsx` (1), `client/src/pages/PremiumDashboard.tsx` (1), `client/src/pages/Signup.tsx` (1) |

### `/resend_verification_pending`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/resend_verification_pending` | POST | `resend_verification_pending` | 11026 | resend verification pending | `client/src/pages/Signup.tsx` (1) |

### `/resolve_issue`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/resolve_issue` | POST | `resolve_issue` | 17318 | resolve issue | — |

### `/resource`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/resource/post/<int:post_id>/delete` | mixed | `delete_resource_post` | 17819 | delete resource post | — |

### `/save_community_announcement`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/save_community_announcement` | POST | `save_community_announcement` | 30996 | save community announcement | `client/src/pages/CommunityFeed.tsx` (1) |

### `/save_community_info`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/save_community_info` | POST | `save_community_info` | 30786 | save community info | — |

### `/seed_dummy_data`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/seed_dummy_data` | POST | `seed_dummy_data` | 31361 | seed dummy data | — |

### `/share_individual_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/share_individual_workout` | POST | `share_individual_workout` | 30060 | share individual workout | — |

### `/share_progress`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/share_progress` | POST | `share_progress` | 29862 | share progress | — |

### `/share_workouts`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/share_workouts` | POST | `share_workouts` | 29960 | share workouts | — |

### `/simple_test`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/simple_test` | GET | `simple_test_route` | 30781 | simple test route | — |

### `/static`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/static/community_backgrounds/<path:filename>` | GET | `community_background_file` | 26098 | community background file | — |
| `/static/uploads/<path:filename>` | GET | `serve_static_uploads` | 24276 | serve static uploads | — |
| `/static/uploads/<path:filename>` | GET | `static_uploaded_file` | 25950 | static uploaded file | — |

### `/subscribe`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/subscribe` | POST | `subscribe` | 12244 | subscribe | `client/src/components/PushInit.tsx` (2), `client/src/utils/nativeDeviceCalendar.ts` (1) |

### `/success`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/success` | GET | `success` | 12268 | success | `client/src/pages/Success.test.tsx` (2), `client/src/App.tsx` (1) |

### `/sw.js`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/sw.js` | GET | `serve_sw` | 5932 | serve sw | `client/src/main.tsx` (1), `client/src/components/PushInit.tsx` (1) |

### `/sync_gym_to_crossfit`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/sync_gym_to_crossfit` | POST | `sync_gym_to_crossfit` | 28371 | sync gym to crossfit | — |

### `/toggle_ad`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/toggle_ad/<int:ad_id>` | POST | `toggle_ad` | 17562 | toggle ad | — |

### `/track_ad_click`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/track_ad_click` | POST | `track_ad_click` | 17443 | track ad click | — |

### `/translate_summary`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/translate_summary` | POST | `translate_summary` | 19778 | translate summary | `client/src/utils/translateSummary.ts` (1) |

### `/update_ad`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_ad/<int:ad_id>` | POST | `update_ad` | 17595 | update ad | — |

### `/update_audio_summary`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_audio_summary` | POST | `update_audio_summary` | 19710 | update audio summary | `client/src/components/EditableAISummary.tsx` (1), `client/src/pages/ChatThread.tsx` (1) |

### `/update_community`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_community` | POST | `update_community` | 23246 | update community | `client/src/pages/EditCommunity.tsx` (1), `client/src/components/community/CommunityOwnerSetupIntro.tsx` (1) |

### `/update_email`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_email` | POST | `update_email` | 11977 | update email | `client/src/pages/AccountSettings.tsx` (1) |

### `/update_exercise_in_workout`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_exercise_in_workout` | POST | `update_exercise_in_workout` | 29706 | update exercise in workout | — |

### `/update_exercise_one_rm`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_exercise_one_rm` | POST | `update_exercise_one_rm` | 29625 | update exercise one rm | — |

### `/update_password`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_password` | POST | `update_password` | 11939 | update password | `client/src/pages/AccountSecurity.tsx` (1), `client/src/components/settings/PrivacySecurityPanel.tsx` (1) |

### `/update_personal_info`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_personal_info` | POST | `update_personal_info` | 12121 | update personal info | `client/src/pages/Profile.tsx` (3) |

### `/update_professional`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_professional` | POST | `update_professional` | 12028 | update professional | `client/src/pages/Profile.tsx` (3) |

### `/update_public_profile`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_public_profile` | POST | `update_public_profile` | 11776 | update public profile | `client/src/pages/AccountSettings.tsx` (1) |

### `/update_user_password`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/update_user_password` | POST | `update_user_password` | 14228 | update user password | — |

### `/upload_community_files`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/upload_community_files` | POST | `upload_community_files` | 30833 | upload community files | — |

### `/upload_logo`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/upload_logo` | POST | `upload_logo` | 11547 | upload logo | — |

### `/upload_profile_picture`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/upload_profile_picture` | POST | `upload_profile_picture` | 11872 | upload profile picture | `client/src/pages/OnboardingChat.tsx` (1), `client/src/pages/OnboardingProfilePicture.tsx` (1), `client/src/pages/Profile.tsx` (1) |

### `/upload_signup_image`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/upload_signup_image` | POST | `upload_signup_image` | 11649 | upload signup image | — |

### `/uploads`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/uploads/<path:filename>` | GET | `serve_uploads` | 24282 | serve uploads | — |

### `/upvote_issue`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/upvote_issue` | POST | `upvote_issue` | 17268 | upvote issue | — |

### `/user_chat`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/user_chat` | GET | `user_chat` | 14183 | user chat | `client/src/App.tsx` (5), `client/src/components/pageTransition.test.ts` (5), `client/src/utils/pushNotificationPayload.test.ts` (5), `client/src/pages/GroupChatThread.tsx` (4), `client/src/pages/Messages.tsx` (3) |
| `/user_chat/<path:subpath>` | GET | `user_chat_subpath` | 14211 | user chat subpath | — |

### `/verify_email`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/verify_email` | GET | `verify_email` | 10839 | verify email | — |

### `/verify_required`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/verify_required` | GET | `verify_required` | 879 | verify required | `client/src/App.tsx` (1), `client/src/pages/MobileLogin.tsx` (1), `client/src/pages/PremiumDashboard.tsx` (1) |

### `/vite.svg`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/vite.svg` | GET | `vite_svg` | 5868 | vite svg | — |

### `/vote_poll`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/vote_poll` | POST | `vote_poll` | 16608 | vote poll | `client/src/pages/Communities.tsx` (1), `client/src/pages/CommunityFeed.tsx` (1), `client/src/pages/CommunityPolls.tsx` (1), `client/src/pages/HomeTimeline.tsx` (1) |

### `/welcome_cards`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/welcome_cards` | GET | `welcome_cards` | 19944 | welcome cards | `client/src/pages/AdminDashboard.tsx` (1), `client/src/pages/OnboardingWelcome.tsx` (1), `admin-web/src/pages/Settings.tsx` (1) |

### `/workout_tracking`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/workout_tracking` | GET | `workout_tracking` | 28540 | workout tracking | `client/src/pages/Communities.tsx` (4), `client/src/App.tsx` (1), `client/src/pages/Gym.tsx` (1), `client/src/pages/YourSports.tsx` (1) |

### `/your_sports`

| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |
|------|-----------|---------|------|-----------------|----------------------|
| `/your_sports` | GET | `your_sports` | 26136 | your sports | `client/src/pages/PremiumDashboard.tsx` (2), `client/src/App.tsx` (1) |

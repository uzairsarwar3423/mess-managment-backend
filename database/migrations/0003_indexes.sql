create index idx_admins_mess_active              on admins (mess_id, is_active);

create index idx_students_mess_active            on students (mess_id, is_active);
create index idx_students_mess_created           on students (mess_id, created_at desc);

-- BR-08: a student may have only one pending payment
create unique index uq_payments_one_pending_per_student
  on payments (student_id) where status = 'pending';
-- BR-10: a transaction id can back only one pending/approved payment per receiving account (case-insensitive)
create unique index uq_payments_transaction
  on payments (payment_account_id, upper(transaction_id)) where status in ('pending', 'approved');
create index idx_payments_mess_status_submitted  on payments (mess_id, status, submitted_at desc);
create index idx_payments_student_submitted      on payments (student_id, submitted_at desc);
create index idx_payment_accounts_mess_active    on payment_accounts (mess_id, is_active, display_order);
create index idx_payments_etag                   on payments (mess_id, screenshot_etag) where screenshot_etag is not null;

create index idx_subscriptions_student_end       on subscriptions (student_id, end_date desc);
create index idx_subscriptions_mess_status_end   on subscriptions (mess_id, status, end_date);

-- active QR labels are unique within a mess
create unique index uq_qr_label_active
  on qr_codes (mess_id, lower(label)) where status = 'active';
create index idx_qr_mess_status                  on qr_codes (mess_id, status);

create index idx_attendance_mess_date_meal       on attendance (mess_id, attendance_date, meal_type);
create index idx_attendance_subscription         on attendance (subscription_id);
create index idx_attendance_qr                   on attendance (qr_code_id);
-- (student_id, attendance_date, meal_type) is already indexed by uq_attendance_student_date_meal

create index idx_notifications_student_created   on notifications (student_id, created_at desc);
create index idx_notifications_unread            on notifications (student_id) where not is_read;

create index idx_push_tokens_user                on push_tokens (user_id);

create index idx_audit_mess_created              on audit_logs (mess_id, created_at desc);
create index idx_audit_entity                    on audit_logs (entity_type, entity_id);
create index idx_audit_actor_created             on audit_logs (actor_id, created_at desc);
create index idx_audit_action                    on audit_logs (action);

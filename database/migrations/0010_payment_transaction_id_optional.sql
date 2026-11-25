-- 0010: students now prove a payment with the SCREENSHOT only. The transaction ID is optional (old rows keep theirs).
-- The format check and the unique index ignore NULL values, so nothing else changes.
alter table payments alter column transaction_id drop not null;

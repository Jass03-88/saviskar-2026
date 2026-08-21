-- Add is_archived column to participant_events
ALTER TABLE participant_events
ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

-- Add index to speed up filtering of archived registrations
CREATE INDEX idx_participant_events_is_archived ON participant_events (is_archived);

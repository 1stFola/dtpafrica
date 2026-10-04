-- Camera segment kinds, onto the contract's vocabulary (docs/vision/58).
--
-- The calibration editor offered `wide`, `close`, `replay` and `other`; the contract, and
-- the rule that keeps a replayed goal out of the match record, speak of `live_play`,
-- `replay`, `intro`, `halftime`, `camera_cut` and `unknown`. The editor now offers the
-- contract's. Rows declared under the old words are carried across:
--
--   wide, close -> live_play   both were play seen through one camera; the framing was
--                              never read by anything
--   other       -> unknown     what scene detection already writes
--   replay      -> replay      unchanged
--
-- Data only: no column changes. Safe to run twice.
--
-- Dated after 20261005100000 for the reason given there: this file must sort after the
-- future-dated migrations already on live.

UPDATE "vision_camera_segments" SET "kind" = 'live_play' WHERE "kind" IN ('wide', 'close');
UPDATE "vision_camera_segments" SET "kind" = 'unknown' WHERE "kind" = 'other';

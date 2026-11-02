-- Operators and assessors watch recordings, and watching now takes fairplay.evidence.view_original.
-- Seeding leaves an existing role's grants alone, so an existing role gets it here. Additive, and
-- does nothing where the roles or the permission do not exist yet: seeding then grants it.
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "admin_roles" r
CROSS JOIN "admin_permissions" p
WHERE r."slug" IN ('fairplay_operator', 'fairplay_assessor')
  AND p."slug" = 'fairplay.evidence.view_original'
ON CONFLICT DO NOTHING;

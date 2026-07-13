INSERT INTO "user" (
	"id",
	"name",
	"email",
	"email_verified",
	"created_at",
	"updated_at"
)
VALUES (
	'mercury-local-publisher',
	'Local Publisher',
	'publisher@mercury.local',
	true,
	now(),
	now()
)
ON CONFLICT DO NOTHING;

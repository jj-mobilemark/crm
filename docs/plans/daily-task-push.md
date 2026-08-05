# Daily Task Push

Opt-in morning email of each rep’s open tasks, sent from their Outlook
mailbox to themselves via Microsoft Graph `Mail.Send`.

## Status

| Piece | State |
| --- | --- |
| Schema (`User.dailyTaskPush`, `dailyTaskPushLastSentOn`) | DONE |
| Settings switch on Microsoft card | DONE |
| `microsoft.setDailyTaskPush` + status fields | DONE |
| `/internal/notifications/daily-tasks` cron route | DONE |
| Railway `cron-daily-tasks` (14:00 + 15:00 UTC) | DONE (awaits api deploy with route) |

## Locked decisions

- Tasks = open `Activity` with `type: TASK` and `createdById = user`.
- Sections: Overdue / Due today / Due this week (through Sunday) / Other.
- Timezone: America/Chicago; send at local hour 9.
- Empty list → skip (no “you’re clear” mail).
- Default off. Enabling needs Mail.Send (same as sequences).

## Smoke (local)

1. Connect Microsoft with Mail.Send; flip **Daily Task Push** on Settings.
2. Create open tasks in overdue / today / this week / undated buckets.
3. Hit the route with force (skips hour-9 gate):

```bash
curl -fsS -X GET -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3001/internal/notifications/daily-tasks?force=1"
```

4. Confirm one Outlook message to self; second call same day is a no-op
   unless you clear `dailyTaskPushLastSentOn`.

## Railway cron (after api ships)

Mirror `cron-followups`:

- Image: `curlimages/curl:8.12.1`
- Schedule: `0 14,15 * * *` (UTC) — service date-gates on Chicago hour 9
- Start:

```bash
sh -c 'curl -fsS -X GET -H "Authorization: Bearer $CRON_SECRET" "$API_PUBLIC_URL/internal/notifications/daily-tasks"'
```

- Vars: `API_PUBLIC_URL`, `CRON_SECRET` (same values as the other crons)

## Key files

| Area | Path |
| --- | --- |
| Schema | `packages/db/prisma/schema.prisma` |
| Job | `apps/api/src/notifications/daily-task-push.service.ts` |
| Route | `apps/api/src/notifications/notifications.controller.ts` |
| Pref | `apps/api/src/microsoft/microsoft-connection.service.ts` |
| UI | `apps/app/app/(app)/settings/microsoft-connection.tsx` |

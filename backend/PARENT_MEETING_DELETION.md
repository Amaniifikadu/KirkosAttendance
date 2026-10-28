# Parent meeting deletion behavior

`DELETE /api/parent-meetings/:meetingId` first removes the selected meeting and
only attendance records whose `meetingId` matches, inside a MongoDB transaction.
This is atomic when the deployment supports transactions (for example, a
replica set or sharded cluster).

For standalone MongoDB deployments, the API falls back only when MongoDB
explicitly reports that transactions are unsupported. It first marks the
meeting `deletionState: "deleting"`, then deletes its attendance records, and
finally deletes the meeting. If an operation fails, the endpoint returns an
error and leaves the marked meeting visible for a safe retry; reads and edits
to that meeting are blocked until deletion is retried. A successful retry
finishes the deletion. No student documents, lesson attendance, or other
meetings are modified.

Meeting attendance edits and metadata edits take the same per-meeting
operation lock, preventing a write from racing standalone deletion cleanup.
If a process is terminated while holding a lock, an administrator must verify
that no request for that meeting is still running, unset `operationLock` on
that one meeting document, and retry deletion. Do not clear locks while a
server process may still be working on the meeting.

No data migration is required. Existing parent meetings without
`deletionState` are treated as active.

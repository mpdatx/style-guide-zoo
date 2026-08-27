---
id: runbook
title: Elevated Queue Depth Escalation Step
genre: technical procedure
source: Written for this repository
license: cc0-original
order: 80
---

If the ingest pipeline backlog alert fires, check the shared order fulfillment event router dashboard for a sustained spike above the SLO threshold before paging the on-call OFR owner, since a brief burst during the nightly batch reconciliation window is expected and should not trigger escalation on its own. Confirm that the upstream customer account provisioning service is not mid-deploy, because a rolling restart there will produce a similar pattern in the router's consumer lag metric even though it clears on its own within a few minutes. Once a genuine backlog is confirmed, drain the dead-letter retry queue processor manually and restart it; it should pick back up where it left off, but if the checkpoint offset looks wrong, escalate to the platform data integrity team rather than restarting again, since a second restart at that point has previously made the underlying issue worse.

# Branch checklist

Ask these at every step. Each "yes, it can happen" becomes a labeled `next` edge, an exit
or a `SHALL NOT` criterion. Skip a question only when the step makes it impossible.

**The person (human steps)**
- Sends the wrong amount: less, more, or the exchange takes its fee out of it?
- Sends the wrong token, or on the wrong network?
- Sends twice, or sends after the order expired?
- Closes the page, reloads, switches device, or the wallet times out mid-send?
- Rejects in the wallet, or lacks balance or gas?

**The outside world (external steps)**
- It is slow, down, or rate-limits us (429)?
- It reports the same event twice, out of order, or never?
- It says success but the chain disagrees? It reports a status we do not know?
- It refunds instead of filling? Where does the refund go, and who is told?

**Our code (script steps)**
- The process dies between two writes, or a job runs twice at once?
- A retry repeats a side effect (a second webhook, a second credit, a second quote)?
- Config changed since the order was created (treasury, routes, mode)?
- Test mode and live mode meet (same database, a real payment to a test address)?
- The merchant's webhook is down for hours?

**Every branch ends somewhere**: back on the path, in `needs_attention` with a reason
and a human next step, or an exit. Name what the user sees and what must never happen.

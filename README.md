# solsend — Agent CFO for crypto teams

> An AI agent that pays a crypto team's bills from their USDC, using one-time virtual cards, with the budget and rules enforced on Solana.

Built for the **University Blockchain Conference (UBC) 2026 Hackathon**.

- **Track:** Agentic Payments and AI
- **Chain award:** Best use of Solana
- **Status:** In progress (hackathon build)

---

## Table of contents

1. [Hackathon facts](#1-hackathon-facts)
2. [The idea](#2-the-idea)
3. [What we're building](#3-what-were-building)
4. [Agent decision loop](#4-agent-decision-loop)
5. [Safety limits](#5-safety-limits)
6. [Demo script](#6-demo-script)
7. [Build plan](#7-build-plan)
8. [Risks and fallbacks](#8-risks-and-fallbacks)
9. [Team](#9-team)
10. [Submission checklist](#10-submission-checklist)

---

## 1. Hackathon facts

| | |
|---|---|
| **Event** | University Blockchain Conference (UBC) 2026 Hackathon |
| **Submit on** | [ubc-hackathon-2026.devpost.com](https://ubc-hackathon-2026.devpost.com) |
| **Deadline** | Friday, Nov 20, 2026, 12:00 PM CST (1:00 PM Halifax time) |
| **Judging** | In person, Sat Nov 21. Finalists get 5 min pitch + 2 min Q&A. Must be there in person to win. |
| **Main track** | Agentic Payments and AI |
| **Chain award** | Best use of Solana |
| **Prizes targeted** | Track Winner ($2,000) + Best use of Solana ($1,500) + Overall winner (1st: $2,500) |
| **Rule** | No pre-existing projects. All code is written during the hackathon. |

### Agentic Payments track requirements

- Agents must make onchain transactions or read the blockchain (devnet is fine).
- The README must document the agent's **decision loop** and the **safety limits**.
- Track wants: spending controls (budgets, allowlists, human approval for large transactions), and agents that can pay safely in stablecoins.

### Best use of Solana requirements

- Core onchain functionality on Solana (devnet is fine). Use Anchor or native Rust for any programs.
- Use Solana-native pieces (SPL tokens / USDC).
- README must list the **program ID(s)** and explain how the project uses Solana.

### Judging criteria

Technical execution · Product & UX · Innovation · Impact & potential · Demo quality

---

## 2. The idea

### The problem

Crypto startups and DAOs hold their money in USDC, but the tools they pay for (AWS, Figma, Vercel, Notion, Google Workspace, etc.) only take cards. Today someone has to cash out USDC to a bank, then pay each bill by hand. It's slow, manual and annoying.

### The solution

1. The team deposits USDC into a **team treasury controlled by a Solana program**.
2. The team sets **rules onchain**: monthly budget, a list of allowed vendors, a max per charge for each vendor, and a limit above which a human must approve.
3. A bill comes in (forwarded email / pasted invoice). The **AI agent** reads it, figures out the vendor and amount, and checks the rules on Solana.
4. If allowed, the program releases the USDC, and the backend creates a **one-time virtual card locked to that vendor for that exact amount**. The agent pays the bill with it and saves a receipt (**receipt hash stored onchain**).
5. If the charge is over the limit, the program **blocks it and creates a pending approval**. A human approves or rejects it.
6. **Bonus:** the agent notices tools that haven't been used in a while (e.g. 60 days) and kills their cards / flags them to cancel.
7. The agent posts updates to Slack/Discord (or an in-app activity feed).

### Why each piece matters

- **Why an agent:** it removes manual work the team hates — cashing out, paying each bill, tracking receipts, catching unused subscriptions.
- **Why a card:** most normal vendors only accept cards, not crypto payment protocols like x402. The card lets the agent pay anywhere.
- **Why Solana:** the budget, vendor rules, approvals and receipts all live onchain, so **the agent cannot overspend even if it makes a mistake or the backend is compromised**.

### How we differ from similar products

| Product | What it is | How we differ |
|---|---|---|
| **Laso Finance** | Cards / gift cards / bank rails for AI agents funded with USDC. General-purpose agent wallet. | We're team expense control with onchain rules, not a general agent wallet. |
| **Locus** | Agent payments via x402 (no cards). | We pay any card-accepting vendor, not just x402-enabled ones. |
| **Ramp / Brex** | Expense cards for normal companies, fiat only. | We serve teams that hold USDC. |
| **solsend (us)** | Ramp-style expense control for teams that hold USDC, run by an agent, with the rules enforced on Solana. | — |

---

## 3. What we're building

### Components

| # | Component | Description |
|---|---|---|
| 1 | **Anchor program** (Solana devnet) | The treasury, the rules and the receipts. |
| 2 | **Backend** (Node / TypeScript) | Agent loop, card service, Solana client, Slack webhook. |
| 3 | **AI agent** | An LLM with tool calls (Claude API or similar). |
| 4 | **Card service** | Lithic sandbox or Stripe Issuing test mode if we can get access. Fallback: a mock card service that returns test card numbers, clearly labeled **"simulated"** in the demo. |
| 5 | **Fake vendor checkout pages** | 2–3 simple fake SaaS checkout pages (clearly fictional brands) that accept the card and show "paid". |
| 6 | **Dashboard** (Next.js) | Team treasury balance, budget used, vendors and their limits, activity feed, pending approvals with approve/reject buttons, receipts with Solana explorer links. |

### Architecture

```
  Bill (email / pasted invoice)
              │
              ▼
   ┌─────────────────────┐        ┌──────────────────────────┐
   │      AI agent       │◄──────►│  Solana program (Anchor) │
   │  (LLM + tool calls) │  read  │  Team · Vendor · Charge  │
   └─────────┬───────────┘  rules │  USDC treasury (PDA)     │
             │          & request_charge                     │
             ▼                    └────────────┬─────────────┘
   ┌─────────────────────┐                     │ USDC released
   │    Card service     │                     ▼
   │ one-time, merchant- │        ┌──────────────────────────┐
   │ locked, exact amount│        │    Settlement wallet     │
   └─────────┬───────────┘        └──────────────────────────┘
             ▼
   ┌─────────────────────┐        ┌──────────────────────────┐
   │ Vendor checkout page│        │ Dashboard (Next.js)      │
   │   → "paid" receipt  │───────►│ + Slack / Discord feed   │
   └─────────────────────┘        └──────────────────────────┘
```

### Anchor program design (draft)

**Program ID (devnet):** _TBD — will be filled in after deploy_

#### Accounts

| Account | Fields |
|---|---|
| `Team` | `authority` (admin wallet), `agent` (agent's public key), `treasury` (PDA-owned USDC token account), `monthly_budget`, `spent_this_period`, `period_start`, `approval_threshold` |
| `Vendor` | `team`, `name/id`, `max_per_charge`, `monthly_cap`, `spent_this_period`, `active` (bool) |
| `Charge` | `team`, `vendor`, `amount`, `status` (Paid / Pending / Rejected), `receipt_hash`, `timestamp` |

#### Instructions

| Instruction | Signer | Behavior |
|---|---|---|
| `init_team(monthly_budget, approval_threshold)` | Admin | Creates the team + treasury. |
| `add_vendor(name, max_per_charge, monthly_cap)` | Admin | Adds a vendor to the allowlist. |
| `set_vendor_active(bool)` | Admin | Enables / disables a vendor. |
| `request_charge(vendor, amount, receipt_hash)` | Agent | Checks: vendor is active, `amount ≤ max_per_charge`, vendor monthly cap not exceeded, team monthly budget not exceeded. If `amount > approval_threshold` → status **Pending**, no funds move. Otherwise → transfer USDC from treasury to the settlement wallet, status **Paid**. |
| `approve_charge` / `reject_charge` | Admin | Resolves **Pending** charges. |

- **Period reset:** spent counters reset when a new month starts (timestamp checked inside `request_charge`).
- **Events:** emitted for each charge so the dashboard can show them.

#### Tokens

Devnet USDC (Circle faucet supports Solana devnet), or a custom SPL test token ("test USDC") if the faucet is a problem.

---

## 4. Agent decision loop

1. **Read** the incoming bill (text / email).
2. **Extract** vendor, amount, due date. If anything is unclear → **ask a human, don't pay**.
3. **Read the onchain rules**: is the vendor allowed? What are the caps? How much budget is left?
4. **Call `request_charge`** on Solana.
5. **If Paid** → create a one-time card locked to vendor + exact amount → pay the vendor checkout → store the receipt hash → post to Slack.
6. **If Pending** → post "needs approval" to Slack / dashboard and stop.
7. **If rejected by the program** → explain why and stop.
8. **Periodic job:** flag vendors with no usage for 60+ days and deactivate their card / suggest canceling.

---

## 5. Safety limits

- **Least-privilege agent key:** the agent's key can only call `request_charge`. It cannot change rules, add vendors or withdraw funds.
- **Onchain enforcement:** all caps are enforced onchain, not just in the backend.
- **Locked-down cards:** cards are single-use, merchant-locked, and for the exact amount.
- **Human-in-the-loop:** human approval is required above a threshold.
- **Refuse when unsure:** the agent never pays if it can't confidently read the bill.

---

## 6. Demo script

2–3 minute video, also used for the live pitch.

1. **Dashboard:** team has 1,000 USDC, $500 monthly budget, vendors: "CloudHost", "DesignPro", "NoteHub" (fictional).
2. **Happy path:** forward a bill — "DesignPro renewal, $45". The agent reads it, checks Solana, pays with a one-time card, and the receipt shows on the dashboard with an explorer link. Slack message appears.
3. **Approval path:** forward a bill — "CloudHost, $380" (over the approval threshold). Blocked onchain, pending approval shows. Admin clicks approve, then it pays.
4. **Rejection path:** forward a bill from a vendor not on the list. Rejected by the program.
5. **Unused subscription:** agent flags "NoteHub unused for 60 days, card disabled."
6. **Close:** *"Your team never touches a bank again, and the agent can't overspend, because the rules live on Solana."*

---

## 7. Build plan

| When | Work |
|---|---|
| **Mon night / Tue** | Anchor program + tests on devnet. Check card sandbox access (Lithic / Stripe Issuing) immediately; if blocked, build the mock card service. |
| **Wed** | Backend + agent loop + card service + fake vendor checkouts. |
| **Thu** | Dashboard, Slack posts, end-to-end runs, bug fixes. |
| **Fri morning** | README (architecture, program ID, decision loop, safety limits, economic/risk notes), record the demo video, submit before 12:00 PM CST. |

**Keep scope tight.** Skipped for the hackathon (see *What we'd build next*): real bank accounts, real KYC, multi-team support, mainnet.

### What we'd build next

- Real bank accounts / off-ramp rails
- Real KYC
- Multi-team support
- Mainnet deployment

---

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Card sandbox access may need approval or be region-limited. | Mock card service, clearly labeled **simulated**. |
| Devnet USDC faucet issues. | Custom SPL token named "test USDC". |
| LLM misreads a bill. | The agent must refuse to pay when unsure; show this in tests. |
| Running out of time. | Cut the unused-subscription feature and Slack; keep the core flow (bill → onchain check → card → pay → receipt) and the blocked-charge demo. |

---

## 9. Team

| Name | Focus |
|---|---|
| **Ritty** | Solana program + payment flow |
| **Turk** | Agent, dashboard, card/checkout pieces (adjust as needed) |
| **Both** | Demo video + README on the last day |

---

## 10. Submission checklist

- [ ] Project name, short description, team members
- [ ] Track: Agentic Payments and AI. Chain award: Solana.
- [ ] Written answers: What did you build? What problem does it solve? How does it work? What makes it unique? What would you build next?
- [ ] Public GitHub repo with source code + setup instructions
- [ ] Working demo or deployed app
- [ ] 2–3 minute demo video (YouTube or Google Drive, publicly viewable)
- [ ] README with technical docs / architecture overview, program IDs, agent decision loop, safety limits

---

## Setup

_Setup instructions will be added as components land (Anchor program, backend, dashboard)._

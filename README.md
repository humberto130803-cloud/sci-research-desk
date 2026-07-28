# SCI Research Desk

A daily-updating research page for one person: chronic C4-C5 spinal cord injury, ASIA C, age 66, based in Panama.

Every morning at 5:00am Panama time a GitHub Action pulls open clinical trials, new papers,
technology news and program updates, scores each one against a saved profile, and publishes the
result. He opens one bookmark and sees what actually changed.

---

## How it fits together

```
profile.json ──┐
data/centers.json ──┤
               ├──> scripts/build.mjs ──> public/data/feed.json ──> Vercel ──> the tablet
data/explored.json ─┘        ▲
                             │
        ClinicalTrials.gov · PubMed · Google News
```

There is no database and no build step. The site is three static files reading one JSON file.

| File | What it does |
|---|---|
| `profile.json` | The medical profile and priority topics. **This is the main knob.** Edit it and everything re-ranks on the next run. |
| `data/centers.json` | Hand-curated rehab programs. No API knows which centers take a 66-year-old chronic cervical patient, so this one list is maintained by hand. |
| `data/explored.json` | Things already researched or ruled out. Anything listed here moves to the Archive instead of resurfacing. |
| `data/seen.json` | Auto-generated. Records the date each item was first seen, which is what drives the "New" badges. Don't edit. |
| `scripts/build.mjs` | The daily job. |
| `scripts/lib/score.mjs` | The relevance engine. |
| `public/` | The site itself. |

## Running it locally

```bash
node scripts/build.mjs
```

```bash
node scripts/serve.mjs
```

Then open http://localhost:4321.

## Deploying

1. Push this folder to a GitHub repository.
2. On [vercel.com](https://vercel.com), *Add New → Project*, import the repo, and deploy. `vercel.json`
   already tells it this is a static site in `public/` — accept the defaults.
3. In the repo's **Settings → Actions → General**, set Workflow permissions to
   **Read and write**. Without this the daily job cannot commit its results.
4. Run the workflow once by hand (Actions → *Daily research run* → *Run workflow*) to confirm it works.

After that it runs itself. Each commit from the job triggers a fresh Vercel deploy automatically.

## The relevance engine, in plain terms

Age is the only hard filter. If a study's own record says the age cap is 65, he is excluded, full
stop — those go to the **Age-blocked** tab rather than being deleted, because caps sometimes have
exceptions and it is worth knowing what he is being kept out of.

Everything else is a *flag*, not a filter. If a study looks like it wants acute injuries, or only
AIS A/B, it still appears — with a plain-language warning saying why it might not fit. Nothing
promising gets silently buried by a regular expression.

Scoring rewards: hand and arm function, spinal cord stimulation, brain-computer interfaces,
breathing, cervical-level and chronic wording, named watchlist organizations, and recency.
It penalises the topics that dominate an SCI search but aren't what he's looking for — pressure
ulcers, questionnaire validation studies, animal models.

Study *topics* are scored on the title and summary only. Eligibility text is read separately, for
the gate checks. Otherwise boilerplate like "uncontrolled blood pressure" fires every priority term
and flattens the ranking.

## Tuning it

Almost all tuning is `profile.json`:

- **Wrong things ranking high?** Add words to `deprioritize.terms`.
- **A topic matters more than the ranking suggests?** Raise its `weight` under `priorities`.
- **Following a specific company or lab?** Add it to `watchlist.organizations`.
- **His grade is reassessed as ASIA D?** Change `asiaGrade`.

The next run picks the changes up, and pushing a change to `profile.json` triggers a run immediately.

After a research session, add what was ruled out to `data/explored.json` with a short note. That
note then shows on the card so nobody re-treads the same ground six weeks later.

## A note on privacy

This repository is public, because public repositories get unlimited free GitHub Actions minutes
and the daily job needs them.

So nothing identifying lives here. `profile.json` carries clinical parameters only — injury level,
grade, age, country — with no name, no date of birth, no clinicians, no record numbers. The
published page shows the same: `C4-C5 · ASIA C · age 66 · Panama`. Keep it that way when editing,
especially in `data/explored.json`, where it is tempting to write "Dr. So-and-so said…".

Saved and archived items are stored in the browser on the device that tapped them. They are never
uploaded, which also means they do not sync between his phone and his tablet. The *Export my list*
button in the footer is the workaround.

## What it is not

This is a shortlist, not medical advice. It reads public registries and ranks them against a
profile — it cannot judge eligibility, and registry records are often out of date. Every promising
item still ends in a phone call or an email to the study team. The page surfaces the candidates and
puts the coordinator's contact details right on the card to make that call easy.

import { useEffect, useState } from "react";
import {
  TEAM_NAME,
  explorerAddress,
  fetchLiveData,
  fetchSnapshot,
  type FairOddsData,
} from "./lib/chain";
import { fmtBps, fmtBrier, fmtTime, fmtUsd, shortAddr } from "./lib/format";

type Provenance = "loading" | "snapshot" | "live";

const STEPS = [
  {
    n: "1",
    title: "Engine",
    body: "A kernel-weighted comparables model estimates P(YES) for each SOL/BTC threshold question — backtested honestly against naive momentum and the flat base rate.",
  },
  {
    n: "2",
    title: "Commit",
    body: "Before trading opens, the keeper writes the prediction — market, probability, strike, model version, hash — into a ForecastRegistry PDA. One record per market: it can never be edited or re-committed.",
  },
  {
    n: "3",
    title: "Seed",
    body: "The pm-AMM market is created with its initial price set to the model's probability (6200 bps = 62%), not a flat 50/50 — the market opens where the model stands.",
  },
  {
    n: "4",
    title: "Resolve",
    body: "At expiry the outcome is read from the reference price. (On devnet today this is a documented Coinbase-at-expiry read — the legacy Pyth devnet feed is stale, and the record says so.)",
  },
  {
    n: "5",
    title: "Attest",
    body: "The keeper attests the outcome and the program itself computes the Brier score in-program, stored next to the original commitment. Anyone can recompute the track record from chain data alone.",
  },
];

export default function App() {
  const [data, setData] = useState<FairOddsData | null>(null);
  const [provenance, setProvenance] = useState<Provenance>("loading");
  const [liveNote, setLiveNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await fetchSnapshot();
        if (!cancelled) {
          setData(snap);
          setProvenance("snapshot");
        }
      } catch {
        /* live fetch below is the fallback */
      }
      try {
        const live = await fetchLiveData();
        if (!cancelled) {
          setData(live);
          setProvenance("live");
        }
      } catch (e) {
        if (!cancelled) {
          setLiveNote(
            `In-browser live refresh unavailable (${e instanceof Error ? e.message : String(e)}). ` +
              "Showing the snapshot fetched live from devnet by scripts/fetch-data.cjs.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const agg = data?.aggregate;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span> FairOdds
        </div>
        <div className="badges">
          <span className="badge badge-devnet">Solana Devnet</span>
          <span className="badge">pm-AMM</span>
          <span className="badge">ForecastRegistry</span>
          <span className="badge badge-team">by {TEAM_NAME}</span>
        </div>
      </header>

      <section className="hero">
        <h1>
          Prediction markets seeded by a model.
          <br />
          <span className="grad">Graded on-chain, forever.</span>
        </h1>
        <p className="lede">
          FairOdds turns a forecasting model into a market maker with a public conscience. The
          model commits every prediction to the ForecastRegistry <em>before</em> its pm-AMM market
          opens, seeds the market at its own probability instead of 50/50, and after resolution the
          program itself computes the Brier score. No cherry-picking, no retro-editing — the track
          record below is read straight from Solana devnet.
        </p>
        {agg && (
          <div className="stat-row">
            <div className="stat">
              <div className="stat-value">{agg.totalPredictions}</div>
              <div className="stat-label">predictions committed on-chain</div>
            </div>
            <div className="stat">
              <div className="stat-value">{agg.resolvedPredictions}</div>
              <div className="stat-label">resolved &amp; scored</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {agg.meanBrier !== null ? fmtBrier(agg.meanBrier) : "—"}
              </div>
              <div className="stat-label">aggregate Brier (lower is better)</div>
            </div>
            <div className="stat">
              <div className="stat-value">{fmtBrier(agg.baselineBrier)}</div>
              <div className="stat-label">flat-50% baseline Brier</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data?.markets.length ?? 0}</div>
              <div className="stat-label">devnet markets</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <h2>How it works</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="track-record">
        <h2>On-chain track record</h2>
        <p className="provenance">
          {provenance === "live" && data && (
            <>
              <span className="dot dot-live" /> Live from Solana devnet — refreshed in your browser
              at {fmtTime(Math.floor(Date.parse(data.fetchedAt) / 1000))}. Source:{" "}
              <code>getProgramAccounts</code> on the ForecastRegistry program, decoded with its IDL.
            </>
          )}
          {provenance === "snapshot" && data && (
            <>
              <span className="dot dot-snap" /> Snapshot fetched live from Solana devnet by{" "}
              <code>scripts/fetch-data.cjs</code> at{" "}
              {fmtTime(Math.floor(Date.parse(data.fetchedAt) / 1000))}.
            </>
          )}
          {provenance === "loading" && "Loading on-chain data…"}
        </p>
        {liveNote && <p className="note">{liveNote}</p>}

        {data && agg && (
          <>
            <div className="brier-compare">
              <div className="brier-row">
                <span className="brier-name">FairOdds model</span>
                <div className="bar-track">
                  <div
                    className="bar bar-model"
                    style={{
                      width: `${agg.meanBrier !== null ? (agg.meanBrier / 0.3) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="brier-val">
                  {agg.meanBrier !== null ? fmtBrier(agg.meanBrier) : "—"}
                </span>
              </div>
              <div className="brier-row">
                <span className="brier-name">Flat-50% baseline</span>
                <div className="bar-track">
                  <div
                    className="bar bar-base"
                    style={{ width: `${(agg.baselineBrier / 0.3) * 100}%` }}
                  />
                </div>
                <span className="brier-val">{fmtBrier(agg.baselineBrier)}</span>
              </div>
              <p className="note">
                Brier score = mean squared error of the probability forecast; 0 is perfect, a coin
                flip scores 0.25.
                {agg.improvementPct !== null &&
                  ` Over ${agg.resolvedPredictions} resolved prediction(s) the model is ${agg.improvementPct.toFixed(1)}% better than the baseline.`}
              </p>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Market</th>
                    <th>Model prob</th>
                    <th>Strike</th>
                    <th>Committed</th>
                    <th>Status</th>
                    <th>Outcome</th>
                    <th>Observed</th>
                    <th>Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r.address}>
                      <td>
                        <a href={explorerAddress(r.address)} target="_blank" rel="noreferrer">
                          {shortAddr(r.address)}
                        </a>
                        <div className="sub">{r.modelVersion}</div>
                      </td>
                      <td>
                        <a href={explorerAddress(r.market)} target="_blank" rel="noreferrer">
                          {shortAddr(r.market)}
                        </a>
                      </td>
                      <td>
                        <strong>{fmtBps(r.modelProbBps)}</strong>
                        <div className="sub">{r.modelProbBps} bps</div>
                      </td>
                      <td>{fmtUsd(r.strikeUsd)}</td>
                      <td>{fmtTime(r.committedAt)}</td>
                      <td>
                        <span className={r.resolved ? "pill pill-done" : "pill pill-open"}>
                          {r.resolved ? "Resolved" : "Open"}
                        </span>
                      </td>
                      <td>{r.resolved ? (r.outcomeYes ? "YES" : "NO") : "—"}</td>
                      <td>{r.resolved ? fmtUsd(r.observedPriceUsd) : "—"}</td>
                      <td>
                        <strong>{r.resolved ? fmtBrier(r.brier) : "—"}</strong>
                        {r.resolved && <div className="sub">e8: {r.brierE8}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="section" id="markets">
        <h2>Markets on devnet</h2>
        <div className="market-grid">
          {data?.markets.map((m) => (
            <article className="market-card" key={m.address}>
              <h3>{m.name || "Untitled market"}</h3>
              <p className="market-label">{m.label}</p>
              <dl>
                <div>
                  <dt>State</dt>
                  <dd>
                    {m.resolved ? (
                      <span className="pill pill-done">Resolved — {m.winningLabel} won</span>
                    ) : (
                      <span className="pill pill-open">Open</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Seed price</dt>
                  <dd>
                    {fmtBps(m.initialPriceBps)} ({m.initialPriceBps} bps)
                  </dd>
                </div>
                <div>
                  <dt>Opened</dt>
                  <dd>{fmtTime(m.startTs)}</dd>
                </div>
                <div>
                  <dt>Ended</dt>
                  <dd>{fmtTime(m.endTs)}</dd>
                </div>
                <div>
                  <dt>Market</dt>
                  <dd>
                    <a href={explorerAddress(m.address)} target="_blank" rel="noreferrer">
                      {shortAddr(m.address)} ↗
                    </a>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
          {!data && <p className="note">Loading markets…</p>}
        </div>
      </section>

      <footer className="footer">
        <p>
          ForecastRegistry program:{" "}
          {data ? (
            <a href={explorerAddress(data.registryProgram)} target="_blank" rel="noreferrer">
              {data.registryProgram}
            </a>
          ) : (
            "G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU"
          )}
          <br />
          pm-AMM program:{" "}
          {data ? (
            <a href={explorerAddress(data.pmammProgram)} target="_blank" rel="noreferrer">
              {data.pmammProgram}
            </a>
          ) : (
            "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
          )}
        </p>
        <p className="note">
          Devnet demo by {TEAM_NAME} — mock USDC only, no real funds. Not financial advice.
        </p>
      </footer>
    </div>
  );
}

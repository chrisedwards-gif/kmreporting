"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  saveRotaShiftFeedback,
  type RotaFeedbackActionState,
} from "@/app/actions/rota-feedback";
import type { RotaWeekFeedback } from "@/lib/data/rota-week-feedback";
import { formatDate } from "@/lib/utils";
import "./rota-week-feedback.css";

const initialState: RotaFeedbackActionState = { status: "idle", message: "" };

const londonToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const weekday = (date: string) => new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
}).format(new Date(`${date}T12:00:00Z`));

const ratingLabel = (rating: RotaWeekFeedback["staffingRating"]) => ({
  very_under: "Very under",
  slightly_under: "Under",
  about_right: "About right",
  slightly_over: "Over",
  very_over: "Very over",
})[rating];

export function RotaWeekFeedbackStrip({
  siteId,
  days,
  feedback,
}: {
  siteId: string;
  days: string[];
  feedback: RotaWeekFeedback[];
}) {
  const feedbackByDate = new Map(feedback.map((item) => [item.businessDate, item]));

  return (
    <section className="rota-feedback-strip panel" aria-labelledby="daily-rota-feedback-title">
      <header>
        <div>
          <p className="page-header__eyebrow">Daily learning loop</p>
          <h2 id="daily-rota-feedback-title">Was the cover right?</h2>
          <p>One click after service feeds real manager judgement into future forecast and staffing calibration.</p>
        </div>
        <span><CircleGauge size={17} /> 30 seconds per day</span>
      </header>
      <div className="rota-feedback-strip__scroll">
        <div className="rota-feedback-strip__grid">
          <div className="rota-feedback-strip__label">
            <strong>Post-shift check</strong>
            <small>Under · right · over</small>
          </div>
          {days.map((date) => (
            <RotaDayFeedback
              current={feedbackByDate.get(date)}
              date={date}
              key={date}
              siteId={siteId}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RotaDayFeedback({
  siteId,
  date,
  current,
}: {
  siteId: string;
  date: string;
  current?: RotaWeekFeedback;
}) {
  const [state, action, pending] = useActionState(saveRotaShiftFeedback, initialState);
  const router = useRouter();
  const available = date <= londonToday();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <article className={`rota-day-feedback ${available ? "" : "rota-day-feedback--future"}`}>
      <div className="rota-day-feedback__date">
        <strong>{weekday(date)}</strong>
        <small>{formatDate(date)}</small>
      </div>

      {!available ? (
        <p>Available after the shift starts.</p>
      ) : (
        <form action={action}>
          <input name="siteId" type="hidden" value={siteId} />
          <input name="businessDate" type="hidden" value={date} />
          <input name="serviceImpact" type="hidden" value="none" />
          <input name="leftEarlyCount" type="hidden" value="0" />
          <input name="stayedLateCount" type="hidden" value="0" />
          <input name="absenceCount" type="hidden" value="0" />
          <input name="wouldRepeat" type="hidden" value="unsure" />
          <input name="notes" type="hidden" value="" />

          {current ? (
            <div className="rota-day-feedback__saved">
              <CheckCircle2 size={14} />
              <span><strong>{ratingLabel(current.staffingRating)}</strong><small>Saved</small></span>
            </div>
          ) : <small className="rota-day-feedback__prompt">How did staffing feel?</small>}

          <div className="rota-day-feedback__choices">
            <button disabled={pending} name="staffingRating" title="Understaffed" type="submit" value="slightly_under">
              <ThumbsDown size={14} /><span>Under</span>
            </button>
            <button disabled={pending} name="staffingRating" title="About right" type="submit" value="about_right">
              <CheckCircle2 size={14} /><span>Right</span>
            </button>
            <button disabled={pending} name="staffingRating" title="Overstaffed" type="submit" value="slightly_over">
              <ThumbsUp size={14} /><span>Over</span>
            </button>
          </div>
          {state.status === "error" ? <small className="rota-day-feedback__error">{state.message}</small> : null}
          <Link href={`/rotas/feedback?site=${encodeURIComponent(siteId)}&date=${date}`}>
            Add detail <ChevronRight size={13} />
          </Link>
        </form>
      )}
    </article>
  );
}

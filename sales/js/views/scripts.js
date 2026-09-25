import { escapeHtml } from '../util.js';

// Static playbook content — pulled from real closed-won GHL conversation
// threads (Kristin, Alan, Jimson, Sam, Akash, Ginger, Josh, Jihad and others,
// pulled live on 2026-09-25) plus a small amount of clearly-labeled general
// practice where no real example exists yet (cold-lead revival). Real lines
// are quoted verbatim — see the "real" tag on each block. GHL's API exposes
// call duration/status but no recording or transcript, so "call" and its
// text fallback share one script here, same as they do for the reps.

function tag(kind, label) {
  return `<span class="tag ${kind}">${label}</span>`;
}

function msg(who, direction, text) {
  return `
    <div class="msg ${direction}">
      <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">${escapeHtml(who)}</div>
      ${escapeHtml(text)}
    </div>`;
}

function thread(rows) {
  return `<div style="display:flex;flex-direction:column;gap:6px;margin:10px 0 2px;">${rows.map(([who, dir, text]) => msg(who, dir, text)).join('')}</div>`;
}

function scriptQuote(label, text) {
  return `<div class="script-quote"><span class="label">${escapeHtml(label)}</span>${escapeHtml(text)}</div>`;
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page-hdr">
      <div>
        <div class="page-title">Scripts</div>
        <div class="page-sub">Call &amp; text scripts built from your own closed-won conversations, plus proven technique where no real example exists yet.</div>
      </div>
    </div>

    <div class="card" style="font-size:12px;color:var(--text-dim);">
      ${tag('real', 'Real close')} blocks are word-for-word from SF City Wash threads that ended in a booking, pulled live from GoHighLevel on Sep 25, 2026.
      ${tag('general', 'General practice')} blocks are proven mobile-detailing sales technique, not SF City Wash history — used only where nothing real exists yet.
      GHL's API doesn't expose call recordings, so the "call" script below is the same language reps text in the same motion as a call attempt.
    </div>

    <div class="script-nav">
      <a href="#s-energy">Energy Matching</a>
      <a href="#s-first">First Contact</a>
      <a href="#s-objections">Objections</a>
      <a href="#s-flow">Booking Flow</a>
      <a href="#s-mistakes">Mistakes &amp; Upsells</a>
      <a href="#s-playbook">Upsell Playbook</a>
      <a href="#s-cold">Cold Leads</a>
      <a href="#s-quickref">Quick Reference</a>
    </div>

    <div class="card" id="s-energy">
      <div class="card-title">Match Their Energy</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">The biggest pattern across closed threads: reply length and tone tracked the customer's almost exactly.</div>

      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">The transactional closer</b>${tag('real', 'Jimson')}</div>
        ${thread([
          ['Jimson', 'in', "I forgot how much you charge for car wash? My friend\nAre you available for coming this Sunday?"],
          ['SF City Wash', 'out', 'Hey Jimson, the full detail for the Porsche Cayenne would start at $229.'],
          ['Jimson', 'in', 'Is $229\nMy car is clean. But I want wax\nI need to know exactly how much money is involved.'],
          ['SF City Wash', 'out', 'Yes $229 would be the exact amount of money involved and sounds good with the Lexus RH 450.'],
        ])}
        <div style="font-size:12px;color:var(--text-dim);">No re-explaining. Rep answered the exact question, in the same length it was asked, and picked up the second car he mentioned without pitching it.</div>
      </div>

      <div style="margin-top:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">The anxious planner</b>${tag('real', 'Ginger')}</div>
        ${thread([
          ['Ginger', 'in', 'also, I signed up for the full package - will there be enough time if you start at 6pm to complete that, since the sun sets by 8pm?'],
          ['SF City Wash', 'out', "We typically take around 2 - 2 and a half hours to complete. We have head lamps and lights if it ends up getting dark. If you'd like to move your appointment earlier, we have..."],
        ])}
        <div style="font-size:12px;color:var(--text-dim);">Matched her specific worry with a specific number and a concrete fallback — never "don't worry," which dismisses a detail-shaped concern.</div>
      </div>

      <div style="margin-top:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">The collaborative communicator</b>${tag('real', 'Akash')}</div>
        ${thread([
          ['Akash', 'in', "Sebastian - my address is 2 van buren, but my driveway/car is parked on Sussex street (our house is on the corner) it's a Mazda cx-5 license plate 8BWR435. Can you start on the outside..."],
          ['SF City Wash', 'out', "Sounds good, thank you for all the information! No worries at all if you're a little late. We'll go ahead and get everything set up while we wait for you to arrive..."],
        ])}
        <div style="font-size:12px;color:var(--text-dim);">Every extra detail got acknowledged, not skimmed. When the rep later missed a spot, he caught it and the rep owned it immediately (see Mistakes below). He rebooked the next week.</div>
      </div>

      <div style="margin-top:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">The warm, effusive customer</b>${tag('real', 'Kristin')}</div>
        ${thread([
          ['Kristin', 'in', 'My car looks brand new- you both did an amazing job!!! 🤩 The seats feel so nice and conditioned. Thank you ☺️'],
          ['SF City Wash', 'out', "Of course! We're happy that we took care of the vehicle. If you get the chance we'd appreciate a quick review, this link makes it pretty easy..."],
        ])}
        <div style="font-size:12px;color:var(--text-dim);">Short and warm, not a paragraph — matched her energy without trying to out-enthuse her. Review ask rode the same message, right at the emotional peak. She booked a second package next visit.</div>
      </div>
    </div>

    <div class="card" id="s-first">
      <div class="card-title">First Contact</div>
      ${scriptQuote('Call / opening text', "Hey [Name], this is [Rep] with SF City Wash. I just received your detail quote request for your [Year Make Model]. Are you available for a quick call today or tomorrow to go over the best option? If text is easier, happy to just go through pricing and availability here.")}
      <div style="font-size:11px;color:var(--muted);margin:-4px 0 14px;">${tag('real', 'Real close')} — opened Alan, Jimson, Sam, Jasmin and Fanny, all of which closed.</div>

      ${scriptQuote('Missed call — auto text', "Hi, sorry we missed your call. We'll get back to you as soon as we get the chance. In the meantime, what services were you looking to get done and for what vehicle?")}
      <div style="font-size:11px;color:var(--muted);margin:-4px 0 14px;">${tag('real', 'Real close')} — the account's actual auto-responder. Works because it hands the lead a specific reason to reply, instead of just apologizing.</div>

      ${scriptQuote('Price framing — say the number, then ask', 'For [service type], our [package] starts at $[price]. Are you looking to get anything specific taken care of — pet hair, mold, anything like that?')}
      <div style="font-size:11px;color:var(--muted);">${tag('real', 'Real close')} — nearly every closed thread leads with an exact dollar figure, never a range. The follow-up question rides the same message.</div>
    </div>

    <div class="card" id="s-objections">
      <div class="card-title">Objections</div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">"I don't have a hose / outlet"</b>${tag('real', 'Kristin, Sam &amp; others')}</div>
      ${scriptQuote('Response', 'No worries at all — we come equipped with our own power and water source, so that shouldn\'t be a problem.')}
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:18px;">This exact sentence closed the objection in at least three separate threads, word for word. It's the most common friction point for apartment/street-parked leads — kill it before it's raised.</div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">"Can you do anything on price?"</b>${tag('real', 'Alan')}</div>
      ${thread([
        ['Alan', 'in', "Thanks for calling me back and setting up the appt. I forgot to ask if yall would be willing to do any discount or promotion on the quoted initial price"],
        ['SF City Wash', 'out', "Hey Alan, apologies for the delayed response. Of course, at the moment we aren't running any promotions, but can get you on our maintenance plan for cheaper details monthly while keeping your car upk..."],
      ])}
      <div style="font-size:12px;color:var(--text-dim);"><b>Never discount ad hoc.</b> Decline plainly, then redirect to the maintenance plan — turns a margin-cutting ask into a recurring-revenue pitch instead of caving or leaving the customer with nothing.</div>
    </div>

    <div class="card" id="s-flow">
      <div class="card-title">Booking-to-Completion Flow</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">The seven touches that run on every closed job. None of the real ones run more than two sentences.</div>
      <div class="timeline">
        ${[
          ['On booking', "Hey [Name]! Your SF City Wash booking is confirmed.\n[Date] · [Time]\n[Service]\nQuestions? Reply or call (415) 360-1964. See you then!"],
          ['Day before', "Hey [Name]! Reminder - your SF City Wash detail is coming up tomorrow.\n[Date] · [Time]\nWe come to you - make sure your vehicle is accessible."],
          ['Morning of', "Hey [Name], getting prepared for your detail today.\nWe'll be there at [Time] - see you soon!"],
          ['En route', "Hey [Name], we're currently on our way and should be arriving on time. See you soon!"],
          ['Arrived', "We've arrived! Take your time coming down, no rush."],
          ['Finished', "Hey [Name], finished up with the vehicle. Take your time."],
          ['Right after — review ask', "Of course! We're happy that we took care of the vehicle. If you get the chance we'd appreciate a quick review, this link makes it pretty easy: [review link] Thank you!"],
        ].map(([when, text]) => `
          <div class="timeline-item">
            <div class="timeline-time">${escapeHtml(when)}</div>
            <div style="font-size:12px;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:4px;white-space:pre-wrap;">${escapeHtml(text)}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;">${tag('real', 'Real close')} — assembled from the Sam, Josh, Jihad, Will and Max jobs. Review ask always rides on the customer's own "thank you," never sent cold.</div>
    </div>

    <div class="card" id="s-mistakes">
      <div class="card-title">Mistakes &amp; Upsells</div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">When you missed a spot</b>${tag('real', 'Akash')}</div>
      ${thread([
        ['Akash', 'in', 'Hey Sebastian - did you guys miss cleaning the trunk door?'],
        ['SF City Wash', 'out', "Hey Akash, based on the photo it looks like I may have forgotten to hit that spot as the trunk was open a majority of the time. What time works best for you to take care of that? Happy to send some available slots. Apologise for this!"],
      ])}
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:18px;">Name the specific miss, own it in one line, offer a concrete fix time — not a generic apology with no next step. He rebooked the following week.</div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;"><b style="font-size:13px;">Upsell timing</b>${tag('real', 'Josh &amp; Kristin')}</div>
      <div style="font-size:12px;color:var(--text-dim);">In both real threads that turned into a second sale, the customer brought it up first — Josh added a second car mid-job, Kristin booked a second package on her next visit after the review ask. <b>Let the second sale surface in-context — right after the "wow" moment or when they mention another vehicle — rather than pitching it unprompted.</b></div>
    </div>

    <div class="card" id="s-playbook">
      <div class="card-title">Upsell &amp; Recommendation Playbook</div>
      <div class="lead-meta" style="margin-bottom:10px;">${tag('team', 'Team knowledge')} — provided directly by the team's senior sales rep, Sep 2026. Technique and judgment, not verified pricing (see the Pricing Reference on each lead's profile for real numbers) — the per-lead Call Helper applies these automatically based on the vehicle on file.</div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Paint Correction by Vehicle Age</div>
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px;">
        <div style="margin-bottom:3px;"><b style="color:var(--text);">2025+</b> — new vehicle. Ask if they want long-term paint protection (ceramic) applied while the paint is still pristine.</div>
        <div style="margin-bottom:3px;"><b style="color:var(--text);">2024</b> — newer vehicle, no correction typically needed.</div>
        <div style="margin-bottom:3px;"><b style="color:var(--text);">2017–2023</b> — ask about paint condition; recommend a 1-step correction if swirls/marring are visible.</div>
        <div><b style="color:var(--text);">Pre-2017</b> — ask about buildup in cupholders and carpets. Described as dirtier than average → +$75 condition add-on may apply.</div>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Interior Difficulty by Brand</div>
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px;">
        <div style="margin-bottom:3px;"><b style="color:var(--green);">Easier to clean</b> — BMW, Mercedes-Benz, Audi, Volvo, Porsche and other German luxury makes.</div>
        <div>Toyota, Honda and Tesla often run <b>embedded</b> carpet contaminants — set expectations with that word rather than promising 100% removal.</div>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Stain Tiers</div>
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px;">
        <div style="margin-bottom:3px;">Minor, a seat or two — <b style="color:var(--text);">included</b> in the standard detail.</div>
        <div style="margin-bottom:3px;">Every seat / larger area — <b style="color:var(--text);">steam treatment, +$50</b>.</div>
        <div>Heavy spills or large staining — recommend <b style="color:var(--text);">Seat Extraction</b> instead.</div>
      </div>

      ${scriptQuote('Pet hair / sand phrasing', 'Only recommend this add-on if the customer specifically wants 100% removal — the standard process clears the majority on its own. Anything left over is "embedded," never promised as fully removed.')}

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px;">Ceramic Tier Guidance</div>
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px;">
        <div style="margin-bottom:3px;"><b style="color:var(--text);">2-Year Sealant</b> — most popular, the default recommendation.</div>
        <div style="margin-bottom:3px;"><b style="color:var(--text);">12-Month Sealant</b> — right for someone only a little interested who wants to see the difference without committing.</div>
        <div>Recommend a correction step alongside 2-Year/5-Year on older or visibly swirled paint.</div>
      </div>

      ${scriptQuote('Default quoting strategy', "Quote the Full Package first — it's the most popular and covers everything except pet hair, large stains, or heavier grime buildup. If the paint feels rough to the touch, recommend a Clay Bar Treatment. Most add-on upsells close easier in person, once the customer can see the vehicle, than over the phone.")}

      <div style="font-size:12px;color:var(--text-dim);margin-top:10px;">All exterior and Full Package bookings already include a <b style="color:var(--text);">6-month wax sealant</b> — mention it as included, not an upsell. Booking-workflow questions → point to <b style="color:var(--text);">sfcitywash.com/express-booking</b>.</div>
    </div>

    <div class="card" id="s-cold">
      <div class="card-title">Reviving a Quiet or Cold Lead</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">No real closed-won example of this exists yet — every sampled thread closed on first or second contact. General practice, not proven SF City Wash language.</div>
      ${scriptQuote('48–72 hours, no reply', "Hey [Name], following up on the [vehicle] detail — still want to get that taken care of? Happy to find a time that works, no pressure either way.")}
      ${scriptQuote('Gone quiet after a quote', "Hey [Name], just want to check in — did the $[price] for [service] work for you, or was there something specific holding it up? Easy to adjust the package if needed.")}
      <div style="font-size:11px;color:var(--muted);">${tag('general', 'General practice')} — a specific, low-effort question outperforms a bare "still interested?" which is easy to ignore.</div>
    </div>

    <div class="card" id="s-quickref">
      <div class="card-title">Quick Reference</div>
      <ol class="principles">
        <li><span class="n">1</span>Exact price, not a range. "Starts around" invites a haggle that doesn't need to exist.</li>
        <li><span class="n">2</span>One qualifying question in the same message as the price.</li>
        <li><span class="n">3</span>Kill the water/power objection before it's raised for any street-parked or apartment lead.</li>
        <li><span class="n">4</span>Match message length and tone to theirs — terse gets terse, warm gets warm.</li>
        <li><span class="n">5</span>Never discount on request. Redirect to the maintenance plan.</li>
        <li><span class="n">6</span>Ask for the review at the emotional peak — right after their "thank you."</li>
        <li><span class="n">7</span>Own mistakes in one line with a concrete fix time, no over-apologizing.</li>
        <li><span class="n">8</span>Let upsells surface in-context — don't pitch a second car or package.</li>
      </ol>
    </div>
  `;
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const indexPath = join(distDir, "index.html");
const aboutPath = join(distDir, "about", "index.html");

const staticAbout = String.raw`
<main class="about2-page" id="main-content">
  <section class="about2-hero" id="about-belief">
    <div class="about2-hero__copy">
      <p class="about2-eyebrow">About DTP Africa</p>
      <p class="about2-hero__position">African football intelligence, visibility, and evidence infrastructure.</p>
      <h1><span>Talent is everywhere.</span><span>Evidence is not.</span></h1>
      <p>Across Africa, exceptional footballers compete every day on community pitches, academy grounds, school fields, and local stadiums. Many have ability. Far fewer have access to the consistent documentation, credible performance evidence, structured visibility, and professional context that help football decision-makers evaluate potential with confidence.</p>
      <strong>DTP Africa exists to change that.</strong>
      <p class="about2-hero__belief">Make Talent Visible. Make Potential Verifiable.</p>
    </div>
  </section>
  <section class="about2-section" id="about-problem">
    <div class="about2-section__heading">
      <p class="about2-eyebrow">The information gap</p>
      <h2>The talent is not missing. The visibility is.</h2>
      <p>Africa has never had a shortage of football talent. The deeper challenge is that too much potential remains difficult to evaluate beyond the moment in which it is seen.</p>
    </div>
    <p>A player may perform brilliantly in a local competition but leave behind little structured evidence.</p>
    <p>A club may develop an exceptional prospect without the digital infrastructure to present that player professionally.</p>
    <p>A scout may hear about a promising footballer but lack enough verified context to make an informed next decision.</p>
    <p>A tournament may generate outstanding performances that disappear when the final whistle blows.</p>
    <p>The result is an information gap between potential and opportunity. DTP Africa is working to close that gap.</p>
  </section>
  <section class="about2-manifesto">
    <h2>We are building the infrastructure between grassroots football and professional decision-making.</h2>
    <p>DTP Africa brings together football data, performance intelligence, match documentation, player profiling, digital visibility, and scouting context within a growing ecosystem.</p>
    <strong>Potential becomes more actionable when it is supported by better evidence.</strong>
  </section>
  <section class="about2-section" id="about-system">
    <div class="about2-section__heading">
      <p class="about2-eyebrow">From potential to proof</p>
      <h2>From the pitch to a decision-maker</h2>
      <p>A connected intelligence pathway designed to turn fragmented football activity into clearer, more useful evidence.</p>
    </div>
    <ol>
      <li><strong>Capture.</strong> We document relevant football activity through match events, competition records, player information, performance tracking, video, and other available sources.</li>
      <li><strong>Verify.</strong> We work to improve the integrity and context of player information so that profiles are built on stronger evidence rather than unsupported claims.</li>
      <li><strong>Interpret.</strong> Raw numbers alone do not tell the full story. We organize performance information into clearer football intelligence.</li>
      <li><strong>Showcase.</strong> DTP Africa helps build structured digital profiles that can preserve relevant performance history and present talent more professionally.</li>
      <li><strong>Connect.</strong> Our long-term objective is to reduce the distance between credible African talent and the stakeholders searching for potential.</li>
    </ol>
  </section>
  <section class="about2-section" id="about-ecosystem">
    <div class="about2-section__heading">
      <p class="about2-eyebrow">Connected football infrastructure</p>
      <h2>More than a scouting platform</h2>
      <p>DTP Africa is not built around the belief that one trial, one highlight video, or one statistic can define a footballer. We are developing an ecosystem that brings multiple layers of evidence together.</p>
    </div>
    <ul>
      <li>Performance intelligence</li>
      <li>Verified player profiles</li>
      <li>Scouting intelligence</li>
      <li>ScoreBoard and match intelligence</li>
      <li>Valuation intelligence</li>
      <li>Club and academy infrastructure</li>
    </ul>
  </section>
  <section class="about2-tech">
    <div class="about2-tech__copy">
      <p class="about2-eyebrow">Technology with football judgment</p>
      <h2>Football intelligence should strengthen judgment, not replace it.</h2>
      <p>Raw numbers alone do not tell the full story. DTP Africa is designed around the belief that technology should improve the information available to players, clubs, coaches, scouts, and decision-makers.</p>
    </div>
  </section>
  <section class="about2-section" id="about-human">
    <p class="about2-eyebrow">Human principle</p>
    <h2>We do not manufacture hype. We improve the evidence.</h2>
    <p>Football will always require human judgment. A dataset cannot fully measure courage. A metric cannot completely explain creativity. An algorithm cannot replace the trained eye of an experienced scout.</p>
    <p>Better context. Better documentation. Better visibility. Better questions. Better-informed decisions.</p>
  </section>
  <section class="about2-story" id="about-story">
    <div class="about2-story__quote">
      <p class="about2-eyebrow">Our Story</p>
      <blockquote>Too much talent disappears without leaving enough evidence behind.</blockquote>
    </div>
    <div class="about2-story__body">
      <p>DTP Africa began with a frustration shared across African grassroots football.</p>
      <p>Exceptional players can spend years developing outside the view of the people positioned to create their next opportunity.</p>
      <p>We saw an opportunity to build infrastructure between these worlds.</p>
      <p>Not another promise of guaranteed professional contracts. Not another platform built purely around highlight videos. Not another system that reduces a footballer to a single score.</p>
      <p>But a growing African football intelligence ecosystem built around visibility, evidence, context, and opportunity.</p>
      <strong>That is DTP Africa.</strong>
    </div>
  </section>
  <section class="about2-founder" id="about-founder">
    <div class="about2-founder__media">
      <img src="/images/about/fola-sanni-ceo.webp" alt="Fola Sanni, Founder and CEO of DTP Africa" loading="lazy" />
    </div>
    <div class="about2-founder__copy">
      <p class="about2-eyebrow">The Founder / CEO</p>
      <h2>Fola Sanni</h2>
      <p class="about2-founder__role">Founder and CEO, DTP Africa</p>
      <div class="about2-founder__body">
        <p>Growing up in Nigeria and remaining deeply connected to its football culture, I saw a recurring problem that talent alone could not solve.</p>
        <p>Across Africa, thousands of gifted young footballers compete, develop, and dedicate themselves to the game, yet too many remain outside the view of professional scouts, clubs, and academies. Not because the talent is absent, but because the evidence around that talent is often fragmented, inconsistent, or difficult to trust.</p>
        <p>As a software and data engineer, I came to understand that the challenge was bigger than exposure. It was also a problem of credibility.</p>
        <p>Scouts and football decision-makers need more than potential. They need context, reliable performance information, structured player histories, and evidence they can evaluate with confidence.</p>
        <p>That realization became the foundation for DTP Africa.</p>
        <p>I set out to help build infrastructure that gives grassroots players and local clubs a stronger, more credible digital presence, one capable of turning match activity, performance data, player records, and development history into a more verifiable football identity.</p>
        <p>For me, this work is deeply personal. Football can represent far more than competition. For many young players and their families, it can become a pathway to economic mobility, professional opportunity, education, travel, and a different future.</p>
        <p>What drives me is the belief that geography, limited visibility, or the absence of the right connection should not be the reason genuine potential goes unseen.</p>
        <p>Through DTP Africa, I am applying my background in software, data, and systems thinking to a human challenge: building better infrastructure around grassroots football so that talent can be documented more clearly, evaluated more fairly, and discovered with greater confidence.</p>
      </div>
      <blockquote>To help ensure that a player's future is shaped more by their ability, evidence, character, and drive-and less by how far they are from opportunity.</blockquote>
    </div>
  </section>
  <section class="about2-mission">
    <article><span>Mission</span><p>To make African grassroots football talent more visible, verifiable, and accessible through better data, documentation, intelligence, and digital infrastructure.</p></article>
    <article><span>Vision</span><p>To build one of Africa's most trusted football talent intelligence ecosystems where credible player evidence can travel further than geography, and where potential can be evaluated with greater context, continuity, and confidence.</p></article>
  </section>
  <section class="about2-section" id="about-principles">
    <div class="about2-section__heading">
      <p class="about2-eyebrow">Operating principles</p>
      <h2>What We Believe</h2>
    </div>
    <ul>
      <li>Talent deserves evidence.</li>
      <li>Data needs context.</li>
      <li>Technology should strengthen human judgment.</li>
      <li>Visibility should preserve dignity.</li>
      <li>African football should build its own intelligence infrastructure.</li>
    </ul>
  </section>
  <section class="about2-final">
    <p class="about2-eyebrow">From Potential to Proof</p>
    <h2>From Potential to Proof.</h2>
    <p>The next exceptional player may already be playing. The question is whether the football world will have enough evidence to recognize the opportunity.</p>
    <strong>DTP Africa is building for that moment.</strong>
  </section>
</main>`;

const html = await readFile(indexPath, "utf8");
const aboutHtml = html
  .replace(/<title>.*?<\/title>/, "<title>About DTP Africa | Football Intelligence Infrastructure</title>")
  .replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
    '<meta name="description" content="DTP Africa is building football intelligence and visibility infrastructure that makes African grassroots talent easier to document, evaluate, compare, discover, and trust." />'
  )
  .replace(/<link rel="canonical" href="[^"]*" \/>/, '<link rel="canonical" href="https://www.dtp.africa/about" />')
  .replace(/<meta property="og:title" content="[^"]*" \/>/, '<meta property="og:title" content="About DTP Africa" />')
  .replace(/<meta property="og:url" content="[^"]*" \/>/, '<meta property="og:url" content="https://www.dtp.africa/about" />')
  .replace('<div id="root"></div>', `<div id="root">${staticAbout}</div>`);

await mkdir(dirname(aboutPath), { recursive: true });
await writeFile(aboutPath, aboutHtml, "utf8");
console.log("Prerendered /about for crawler-visible content");

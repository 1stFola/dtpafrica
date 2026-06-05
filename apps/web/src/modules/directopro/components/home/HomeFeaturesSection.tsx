import { HomeFeaturedTalentCarousel } from "./HomeFeaturedTalentCarousel";
import { HomeIntelligenceTeasers } from "./HomeIntelligenceTeasers";
import { HomeLiveMatchCenter } from "./HomeLiveMatchCenter";
import { HomePlayerHighlights } from "./HomePlayerHighlights";

export function HomeFeaturesSection() {
  return (
    <div className="home-features">
      <HomeFeaturedTalentCarousel />
      <HomeIntelligenceTeasers />
      <HomePlayerHighlights />
      <HomeLiveMatchCenter />
    </div>
  );
}

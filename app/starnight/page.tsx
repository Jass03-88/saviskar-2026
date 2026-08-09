import Hero from "@/components/starnight/Hero/Hero";
import PastPerformances from "@/components/starnight/PastPerformances/PastPerformances";
import GuessArtist from "@/components/starnight/GuessArtist/GuessArtist";
import LightsOut from "@/components/starnight/LightsOut/LightsOut";
import StarNightReveal from "@/components/starnight/StarNightReveal";

export default function StarNightPage() {
  return (
    <main className="w-full overflow-x-hidden bg-black">
      <Hero />

      <PastPerformances />

      <GuessArtist />

      <LightsOut />

      <StarNightReveal />
    </main>
  );
}
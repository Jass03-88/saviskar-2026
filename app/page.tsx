import Navbar from "@/components/ui/Navbar";
import Hero from "@/components/home/Hero";
import Story from "@/components/home/Story";
import About from "@/components/home/About";
import Events from "@/components/home/Events";
import Gallery from "@/components/home/Gallery";
import StarNight from "@/components/home/StarNight";
import RegisterCTA from "@/components/home/RegisterCTA";
import Footer from "@/components/ui/Footer";

export default function Home() {
  return (
    <main>
      <Navbar />

      <Hero />
      <Story />
      <About />
      <Events />
      <Gallery />
      <StarNight />
      <RegisterCTA />

      <Footer />
    </main>
  );
}
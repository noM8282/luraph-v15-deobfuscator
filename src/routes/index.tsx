import { createFileRoute } from "@tanstack/react-router";
import { DeobfStudio } from "@/components/deobf-studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <DeobfStudio />;
}

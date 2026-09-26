import { SavedPlayer } from "@/components/library/saved-player";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <SavedPlayer id={(await params).id} />; }

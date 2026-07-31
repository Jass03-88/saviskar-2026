import { createClient } from "@/lib/supabase/client";

/*
 * Compatibility export for existing client components.
 * New code should prefer createClient() from "@/lib/supabase/client".
 */
export const supabase = createClient();

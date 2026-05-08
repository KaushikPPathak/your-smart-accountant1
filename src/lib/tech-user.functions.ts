import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TECH_USER_EMAIL, TECH_USER_PASSWORD } from "./tech-user-credentials";

export const ensureTechnicalUser = createServerFn({ method: "POST" }).handler(async () => {
  let page = 1;
  let userId: string | undefined;

  while (!userId && page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to check app login user: ${error.message}`);

    userId = data.users.find((u) => u.email?.toLowerCase() === TECH_USER_EMAIL.toLowerCase())?.id;
    if (userId || data.users.length < 1000) break;
    page += 1;
  }

  if (userId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: TECH_USER_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Unable to refresh app login user: ${error.message}`);
    return { ok: true, created: false };
  }

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email: TECH_USER_EMAIL,
    password: TECH_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Unable to create app login user: ${error.message}`);

  return { ok: true, created: true };
});
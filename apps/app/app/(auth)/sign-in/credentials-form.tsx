"use client";

import { signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function CredentialsForm() {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);

		const { error } = await signIn.email({
			email: email.trim(),
			password,
		});

		if (error) {
			toast.error(error.message ?? "Could not sign in.");
			setPending(false);
			return;
		}

		// The session cookie is set; land on the app.
		router.push("/");
		router.refresh();
	}

	return (
		<form className="flex flex-col gap-5" onSubmit={handleSubmit}>
			<Field>
				<FieldLabel htmlFor="email">Email</FieldLabel>
				<Input
					id="email"
					name="email"
					type="email"
					autoComplete="email"
					required
					placeholder="you@company.com"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
				/>
			</Field>

			<Field>
				<FieldLabel htmlFor="password">Password</FieldLabel>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="current-password"
					required
					minLength={8}
					placeholder="••••••••"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			</Field>

			<Button className="w-full" disabled={pending} type="submit">
				{pending && <Spinner data-icon="inline-start" />}
				Sign in
			</Button>
		</form>
	);
}

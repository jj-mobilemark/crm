"use client";

import { signIn, signUp } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Mode = "sign-in" | "register";

export function CredentialsForm() {
	const router = useRouter();
	const [mode, setMode] = useState<Mode>("sign-in");
	const [pending, setPending] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	const isRegister = mode === "register";

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);

		const { error } = isRegister
			? await signUp.email({
					name: name.trim() || email.split("@")[0] || "User",
					email: email.trim(),
					password,
				})
			: await signIn.email({ email: email.trim(), password });

		if (error) {
			toast.error(
				error.message ??
					(isRegister ? "Could not create the account." : "Could not sign in."),
			);
			setPending(false);
			return;
		}

		// The session cookie is set; land on the app.
		router.push("/");
		router.refresh();
	}

	return (
		<form className="flex flex-col gap-5" onSubmit={handleSubmit}>
			{isRegister && (
				<Field>
					<FieldLabel htmlFor="name">Name</FieldLabel>
					<Input
						id="name"
						name="name"
						autoComplete="name"
						placeholder="Ada Lovelace"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
			)}

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
					autoComplete={isRegister ? "new-password" : "current-password"}
					required
					minLength={8}
					placeholder="••••••••"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			</Field>

			<Button className="w-full" disabled={pending} type="submit">
				{pending && <Spinner data-icon="inline-start" />}
				{isRegister ? "Create account" : "Sign in"}
			</Button>

			<button
				type="button"
				className="text-center text-muted-foreground text-sm/5 underline underline-offset-4 hover:text-foreground"
				onClick={() => setMode(isRegister ? "sign-in" : "register")}
			>
				{isRegister
					? "Already have an account? Sign in"
					: "Need an account? Create one"}
			</button>
		</form>
	);
}

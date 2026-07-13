import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@mercury/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
	"group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-clip-padding font-medium text-xs outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		defaultVariants: {
			size: "default",
			variant: "default",
		},
		variants: {
			size: {
				default:
					"h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				icon: "size-9",
				"icon-lg": "size-10",
				"icon-sm": "size-8",
				"icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
				lg: "h-10 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				sm: "h-8 gap-1 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
			},
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
				destructive:
					"bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 dark:hover:bg-destructive/30",
				dropzone:
					"border-border/80 border-dashed bg-muted/20 text-foreground hover:border-primary/35 hover:bg-accent/35 [&_[data-slot=dropzone-hint]]:font-normal [&_[data-slot=dropzone-hint]]:text-[11px] [&_[data-slot=dropzone-hint]]:text-muted-foreground [&_[data-slot=dropzone-icon]>svg]:size-5 [&_[data-slot=dropzone-icon]]:flex [&_[data-slot=dropzone-icon]]:size-11 [&_[data-slot=dropzone-icon]]:items-center [&_[data-slot=dropzone-icon]]:justify-center [&_[data-slot=dropzone-icon]]:rounded-lg [&_[data-slot=dropzone-icon]]:bg-accent [&_[data-slot=dropzone-icon]]:text-primary [&_[data-slot=dropzone-icon]]:shadow-xs [&_[data-slot=dropzone-title]]:font-semibold",
				ghost:
					"hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
				link: "text-primary underline-offset-4 hover:underline",
				outline:
					"border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
			},
		},
	}
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			className={cn(buttonVariants({ className, size, variant }))}
			data-slot="button"
			{...props}
		/>
	);
}

export { Button, buttonVariants };

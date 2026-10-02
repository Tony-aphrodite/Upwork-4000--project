/**
 * WhatsApp share links (step 8), until the Business API arrives in step 10. In the demo every
 * phone number is the placeholder 0123456788, so the link opens WhatsApp without a recipient
 * rather than risk pointing at somebody's real number.
 */
const DEMO_NUMBER = "0123456788";

export function whatsappLink(phone: string | null | undefined, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const intl = digits && digits !== DEMO_NUMBER ? (digits.startsWith("0") ? `249${digits.slice(1)}` : digits) : "";
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

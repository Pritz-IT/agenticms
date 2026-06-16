import React from "react";

export const keys = {
  "hero.title": { type: "text", initial: "Welcome to Our Company" },
  "hero.subtitle": { type: "text", initial: "We build great software" },
  "body.text": { type: "richtext", initial: "Lorem ipsum dolor sit amet..." },
  "_meta.title": { type: "text", initial: "Home — My Company" },
  "_meta.description": { type: "text", initial: "Welcome to our website" },
  "sidebar.image": { type: "image", initial: "/images/default.jpg" },
  "cta.link": { type: "link", initial: "/contact" },
};

interface Props { content: Record<string, string>; }
export default function HeroLayout({ content }: Props) {
  return <div><h1>{content["hero.title"]}</h1></div>;
}

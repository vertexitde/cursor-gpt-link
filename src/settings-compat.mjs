// From 3.32 Cursor's settings cards are built from parts: a card namespace
// (Root, Header, Title, Description, Group, Preview) and a row namespace
// (Root, Content, Title, Description, Control). The links' cards were written
// against the older shape, a card with title and description and a namespace
// with Root, Entry and Preview. This adapter gives them that shape on top of
// the new parts, so the same card code serves both.
//
// tag keeps each link's names apart: the adapters are constants, and two
// links can put theirs in the same scope.
export function settingsCompatSrc(tag, jsx, {cardNs, rowNs}) {
  return `
const __${tag}SettingsCard=props=>${jsx}(${cardNs}.Root,{children:[${jsx}(${cardNs}.Header,{children:[${jsx}(${cardNs}.Title,{children:props.title},"title"),props.description==null?null:${jsx}(${cardNs}.Description,{children:props.description},"description")]},"header"),props.children]});
const __${tag}SettingsRows={Root:props=>${jsx}(${cardNs}.Group,{accessibleLabel:props.accessibleLabel,variant:"tinted",children:props.children}),Entry:props=>${jsx}(${rowNs}.Root,{layout:props.layout,children:[${jsx}(${rowNs}.Content,{children:${jsx}(${rowNs}.Title,{children:props.label})},"label"),${jsx}(${rowNs}.Control,{children:props.children},"value")]}),Preview:${cardNs}.Preview};
`;
}

// The card and row names a card generator should use on this build, and the
// adapter to put in front of it (empty before 3.32).
export function settingsParts(tag, jsx, s) {
  if (!s.cardNs) return {card:s.card, zs:s.zs, adapter:''};
  return {card:`__${tag}SettingsCard`, zs:`__${tag}SettingsRows`, adapter:settingsCompatSrc(tag, jsx, s)};
}

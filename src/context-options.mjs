// Use the subscription catalog's declared window. An API model's context limit
// does not establish subscription availability, and neither does the binary's
// built-in default catalog: only the fetched catalog says what this account
// gets. The catalog can also grant a larger experimental window per model, and
// then it is offered on top, so the option appears by itself once the account
// has it.
export function contextSizes(model) {
  const full=Number(model.context_window);
  if(!Number.isSafeInteger(full)||full<=0)throw new Error('Model catalog has no valid context window.');
  const sizes=[Math.min(200000,full),full];
  const experimental=Number(model.max_context_window);
  if(model.supports_experimental_context===true&&Number.isSafeInteger(experimental)&&experimental>full)sizes.push(experimental);
  return [...new Set(sizes)];
}
export const contextLabel=value=>value>=1000000?String(value/1000000)+'M':String(value/1000)+'K';
export function contextDefinition(sizes) {
  return {id:'context',name:'Context',markdownTooltip:'Choose the conversation context window. A larger window can use more of your subscription allowance and take longer. Reasoning effort and Fast are configured separately.',
    parameterType:{enumParameter:{values:sizes.map(value=>({value:String(value),displayName:contextLabel(value),modelPickerBadges:[]}))}}};
}

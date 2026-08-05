// Mock pull-request data — lets the whole app run with NO Azure/ADO subscription.
// Later, api/adoClient.js will replace this with real Azure DevOps REST calls,
// and api/aiClient.js will replace the canned summaries with Azure OpenAI output.

const PRS = [
  {
    id: 101,
    title: "Fix label + comment on SalesTable",
    author: "Avinash Ramu",
    risk: "low",
    filesChanged: 3,
    summaryShort: "3 files · no logic change",
    summary:
      "Renames a user-facing label and adds a clarifying code comment on SalesTable. No behavioural change and no data impact. Safe to approve.",
    checks: { build: true, labels: true, rebase: true },
    diffFile: "SalesTable.Label.xml",
    diff: [
      { type: "ctx", text: "  <!-- credit hold label -->" },
      { type: "del", text: "- <Label>Credit limit</Label>" },
      { type: "add", text: "+ <Label>Credit limit (customer)</Label>" },
      { type: "ctx", text: "  <!-- clarify intent -->" },
      { type: "add", text: "+ // Shown on the customer hold dialog" },
    ],
    commentDraft:
      "Looks good — clear label change. Please confirm the label ID is reused from @SYS if one already exists before merging.",
  },
  {
    id: 102,
    title: "Add validation rule to PurchLine",
    author: "Jawahar Ravi",
    risk: "medium",
    filesChanged: 6,
    summaryShort: "6 files · needs rebase",
    summary:
      "Adds a quantity validation on PurchLine and a supporting EDT. Logic is contained but the branch is 5 commits behind main and touches a shared table method. Review the validate() override and rebase before merge.",
    checks: { build: true, labels: true, rebase: false },
    diffFile: "PurchLine.validateWrite.xpp",
    diff: [
      { type: "ctx", text: "  public boolean validateWrite()" },
      { type: "ctx", text: "  {" },
      { type: "add", text: "+     if (this.PurchQty <= 0)" },
      { type: "add", text: "+         return checkFailed(\"Quantity must be positive\");" },
      { type: "ctx", text: "      return super();" },
      { type: "ctx", text: "  }" },
    ],
    commentDraft:
      "Please rebase onto main (5 commits behind) and add a unit test covering the zero-quantity path before this can be approved.",
  },
  {
    id: 103,
    title: "Change posting logic in SalesTableType",
    author: "Uttaran Ghorai",
    risk: "high",
    filesChanged: 9,
    summaryShort: "SalesTableType · no test",
    summary:
      "Modifies the credit-hold posting path in SalesTableType. This is high-impact posting logic, there is no unit test covering the new branch, and the branch is 12 commits behind main. Recommend requesting changes: add tests and rebase.",
    checks: { build: false, labels: false, rebase: false },
    diffFile: "SalesTableType.checkCreditLimit.xpp",
    diff: [
      { type: "ctx", text: "  // credit hold check" },
      { type: "del", text: "- if (custTable.CreditMax > 0)" },
      { type: "add", text: "+ if (this.checkCreditHold())" },
      { type: "add", text: "+ {" },
      { type: "add", text: "+     postingEngine.hold();" },
      { type: "add", text: "+ }" },
      { type: "ctx", text: "  // ..." },
      { type: "ctx", text: "  ⚠ no test covering this path" },
    ],
    commentDraft:
      "Please add a unit test for the new credit-hold path in SalesTableType, and rebase onto main (12 commits behind) before this can be approved. Also confirm the build failure is resolved.",
  },
  {
    id: 104,
    title: "Update number sequence for InventJournal",
    author: "Ramya Shanmugam",
    risk: "low",
    filesChanged: 2,
    summaryShort: "2 files · config only",
    summary:
      "Configuration change adding a new number-sequence reference for InventJournal. No X++ logic changed. Build is green and labels are correct. Safe to approve.",
    checks: { build: true, labels: true, rebase: true },
    diffFile: "NumberSeqModuleInvent.xpp",
    diff: [
      { type: "ctx", text: "  // register scope" },
      { type: "add", text: "+ datatype.parmReferenceHelp(\"Invent journal id\");" },
      { type: "add", text: "+ this.create(datatype);" },
    ],
    commentDraft:
      "Config change looks fine. Confirm the number sequence has been set up in the target environment before release.",
  },
];

module.exports = { PRS };

// Default import of node:https in a JavaScript source.
import https from 'node:https'

const agent = new https.Agent({ keepAlive: false })
console.log(agent !== null, agent.keepAlive)

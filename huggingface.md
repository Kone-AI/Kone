## Functions

<dl>
<dt><a href="#intialize">intialize()</a> ⇒ <code>Promise.&lt;void&gt;</code></dt>
<dd><p>Initializes the ChatBot instance.</p>
</dd>
<dt><a href="#switchModel">switchModel(value)</a></dt>
<dd><p>Switches the current model for the chat.</p>
</dd>
<dt><a href="#listAvilableModels">listAvilableModels()</a> ⇒ <code>Array.&lt;Model&gt;</code></dt>
<dd><p>Lists available models that can be used with the chat.</p>
</dd>
<dt><a href="#listAvilableSesson">listAvilableSesson()</a> ⇒ <code>Array.&lt;Sesson&gt;</code></dt>
<dd><p>Lists available sessions for the chat.</p>
</dd>
<dt><a href="#showCurrentModel">showCurrentModel()</a> ⇒ <code>Model</code> | <code>null</code></dt>
<dd><p>Returns the currently selected model for the chat.</p>
</dd>
<dt><a href="#getRemoteConversations">getRemoteConversations()</a> ⇒ <code>Promise.&lt;Array.&lt;Sesson&gt;&gt;</code></dt>
<dd><p>Fetches remote conversations from a server.</p>
</dd>
<dt><a href="#getRemoteLlms">getRemoteLlms()</a> ⇒ <code>Promise.&lt;Array.&lt;Model&gt;&gt;</code></dt>
<dd><p>Fetches remote LLMs from a server.</p>
</dd>
<dt><a href="#getNewChat">getNewChat()</a> ⇒ <code>Promise.&lt;Conversation&gt;</code></dt>
<dd><p>Initializes a new chat conversation.</p>
</dd>
<dt><a href="#chat">chat(text, currentConversionID, options)</a> ⇒ <code>Promise.&lt;ChatResponse&gt;</code></dt>
<dd><p>Initiates a chat with the provided text.</p>
</dd>
<dt><a href="#getConversationHistory">getConversationHistory()</a> ⇒ <code>Promise.&lt;Conversation&gt;</code></dt>
<dd><p>get the details of current conversation</p>
</dd>
</dl>

<a name="intialize"></a>

## intialize() ⇒ <code>Promise.&lt;void&gt;</code>
Initializes the ChatBot instance.

**Kind**: global function  
<a name="switchModel"></a>

## switchModel(value)
Switches the current model for the chat.

**Kind**: global function  
**Throws**:

- <code>Error</code> If the provided model ID is not a string or if the model is not found.


| Param | Type | Description |
| --- | --- | --- |
| value | <code>string</code> | The ID of the model to switch to. |

<a name="listAvilableModels"></a>

## listAvilableModels() ⇒ <code>Array.&lt;Model&gt;</code>
Lists available models that can be used with the chat.

**Kind**: global function  
**Returns**: <code>Array.&lt;Model&gt;</code> - An array of available model names.  
<a name="listAvilableSesson"></a>

## listAvilableSesson() ⇒ <code>Array.&lt;Sesson&gt;</code>
Lists available sessions for the chat.

**Kind**: global function  
**Returns**: <code>Array.&lt;Sesson&gt;</code> - An array of available sessions.  
<a name="showCurrentModel"></a>

## showCurrentModel() ⇒ <code>Model</code> \| <code>null</code>
Returns the currently selected model for the chat.

**Kind**: global function  
**Returns**: <code>Model</code> \| <code>null</code> - The current model.  
<a name="getRemoteConversations"></a>

## getRemoteConversations() ⇒ <code>Promise.&lt;Array.&lt;Sesson&gt;&gt;</code>
Fetches remote conversations from a server.

**Kind**: global function  
**Returns**: <code>Promise.&lt;Array.&lt;Sesson&gt;&gt;</code> - A promise that resolves to an array of fetched conversations.  
**Throws**:

- <code>Error</code> If the server response is not successful.

<a name="getRemoteLlms"></a>

## getRemoteLlms() ⇒ <code>Promise.&lt;Array.&lt;Model&gt;&gt;</code>
Fetches remote LLMs from a server.

**Kind**: global function  
**Returns**: <code>Promise.&lt;Array.&lt;Model&gt;&gt;</code> - A promise that resolves to an array of fetched conversations.  
**Throws**:

- <code>Error</code> If the server response is not successful.

<a name="getNewChat"></a>

## getNewChat() ⇒ <code>Promise.&lt;Conversation&gt;</code>
Initializes a new chat conversation.

**Kind**: global function  
**Returns**: <code>Promise.&lt;Conversation&gt;</code> - The conversation ID of the new chat.  
**Throws**:

- <code>Error</code> If the creation of a new conversation fails.

<a name="chat"></a>

## chat(text, currentConversionID, options) ⇒ <code>Promise.&lt;ChatResponse&gt;</code>
Initiates a chat with the provided text.

**Kind**: global function  
**Returns**: <code>Promise.&lt;ChatResponse&gt;</code> - An object containing conversation details.  
**Throws**:

- <code>Error</code> If there is an issue with the chat request.


| Param | Type | Description |
| --- | --- | --- |
| text | <code>string</code> | The user's input text or prompt. |
| currentConversionID | <code>string</code> | The conversation ID for the current chat. |
| options | <code>ChatOptions</code> |  |

<a name="getConversationHistory"></a>

## getConversationHistory() ⇒ <code>Promise.&lt;Conversation&gt;</code>
get the details of current conversation

**Kind**: global function  
**Returns**: <code>Promise.&lt;Conversation&gt;</code> - A Promise that return conversation details  
**Throws**:

- <code>Error</code> If there is an api error




## Functions

<dl>
<dt><a href="#parseCookies">parseCookies()</a> ⇒ <code>string</code></dt>
<dd><p>Parses cookies into a formatted string.</p>
</dd>
<dt><a href="#get">get(url, _parms)</a> ⇒ <code>Promise.&lt;AxiosResponse&gt;</code></dt>
<dd><p>Sends an HTTP GET request.</p>
</dd>
<dt><a href="#post">post(url, data, _headers)</a> ⇒ <code>Promise.&lt;AxiosResponse&gt;</code></dt>
<dd><p>Sends an HTTP POST request.</p>
</dd>
<dt><a href="#refreshCookies">refreshCookies(response)</a></dt>
<dd><p>Refreshes cookies based on the response headers.</p>
</dd>
<dt><a href="#signinWithEmail">signinWithEmail()</a></dt>
<dd><p>Attempts to sign in with the provided email and password.</p>
</dd>
<dt><a href="#getAuthUrl">getAuthUrl()</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Retrieves the authentication URL for a chat.</p>
</dd>
<dt><a href="#getCrpf">getCrpf(input)</a> ⇒ <code>string</code> | <code>null</code></dt>
<dd><p>Extracts CSRF token from a string.</p>
</dd>
<dt><a href="#grantAuth">grantAuth(url)</a> ⇒ <code>Promise.&lt;number&gt;</code></dt>
<dd><p>Grants authorization by following redirects.</p>
</dd>
<dt><a href="#login">login(cache_path)</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Initiates the login process.</p>
</dd>
<dt><a href="#cacheLogin">cacheLogin(path)</a></dt>
<dd><p>Caches login data to a file.</p>
</dd>
<dt><a href="#loadLoginCache">loadLoginCache(path)</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Loads cached login data from a file.</p>
</dd>
</dl>

<a name="parseCookies"></a>

## parseCookies() ⇒ <code>string</code>
Parses cookies into a formatted string.

**Kind**: global function  
**Returns**: <code>string</code> - A formatted string containing parsed cookies.  
<a name="get"></a>

## get(url, _parms) ⇒ <code>Promise.&lt;AxiosResponse&gt;</code>
Sends an HTTP GET request.

**Kind**: global function  
**Returns**: <code>Promise.&lt;AxiosResponse&gt;</code> - A Promise that resolves to the HTTP response.  

| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL to send the GET request to. |
| _parms | <code>Record.&lt;string, any&gt;</code> | Optional query parameters for the request. |

<a name="post"></a>

## post(url, data, _headers) ⇒ <code>Promise.&lt;AxiosResponse&gt;</code>
Sends an HTTP POST request.

**Kind**: global function  
**Returns**: <code>Promise.&lt;AxiosResponse&gt;</code> - A Promise that resolves to the HTTP response.  

| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL to send the POST request to. |
| data | <code>Record.&lt;string, any&gt;</code> | Data to include in the request body. |
| _headers | <code>Record.&lt;string, any&gt;</code> | Optional additional headers for the request. |

<a name="refreshCookies"></a>

## refreshCookies(response)
Refreshes cookies based on the response headers.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| response | <code>AxiosResponse</code> | The HTTP response to extract cookies from. |

<a name="signinWithEmail"></a>

## signinWithEmail()
Attempts to sign in with the provided email and password.

**Kind**: global function  
**Throws**:

- <code>Error</code> If the sign-in fails.

<a name="getAuthUrl"></a>

## getAuthUrl() ⇒ <code>Promise.&lt;string&gt;</code>
Retrieves the authentication URL for a chat.

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - A Promise that resolves to the authentication URL.  
**Throws**:

- <code>Error</code> If the URL retrieval fails.

<a name="getCrpf"></a>

## getCrpf(input) ⇒ <code>string</code> \| <code>null</code>
Extracts CSRF token from a string.

**Kind**: global function  
**Returns**: <code>string</code> \| <code>null</code> - The extracted CSRF token or null if not found.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>string</code> | The input string containing CSRF information. |

<a name="grantAuth"></a>

## grantAuth(url) ⇒ <code>Promise.&lt;number&gt;</code>
Grants authorization by following redirects.

**Kind**: global function  
**Returns**: <code>Promise.&lt;number&gt;</code> - A Promise that resolves to a status code.  
**Throws**:

- <code>Error</code> If the authorization process fails.


| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL to grant authorization for. |

<a name="login"></a>

## login(cache_path) ⇒ <code>Promise.&lt;string&gt;</code>
Initiates the login process.

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - A Promise that resolves to the parsed cookies.  
**Throws**:

- <code>Error</code> If the login process fails.


| Param | Type | Description |
| --- | --- | --- |
| cache_path | <code>string</code> | Optional path for caching login data. |

<a name="cacheLogin"></a>

## cacheLogin(path)
Caches login data to a file.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>string</code> | The path where login data will be cached. |

<a name="loadLoginCache"></a>

## loadLoginCache(path) ⇒ <code>Promise.&lt;string&gt;</code>
Loads cached login data from a file.

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - A Promise that resolves to the cached login data.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>string</code> | The path to the cached login data file. |





**Deprecation Notice**

> The versions 2.x and lower are deprecated please use latest.
 
# Huggingface chat api 
A simple api for hugging face chat with login caching.

## Installation

Current stable release (`4.x`) 
> Added tools support 🎉

```sh
npm i huggingface-chat
``` 


## Example usage 
```js

import { Login ,ChatBot} from "huggingface-chat";

const EMAIL = "email"
const PASSWD = "password"
const cachePath = "./login_cache/"
const signin = new Login(EMAIL, PASSWD)
const res = await signin.login(cachePath) // default path is ./login_cache/
const chat = new ChatBot(res) // res is cookies which is required for subsequent aip calls

await chat.intialize()

const models = chat.listAvilableModels()
console.log(models)


const sessons = chat.listAvilableSesson()
console.log(sessons)

// more info : https://huggingface.co/chat/models
let currentModel = chat.showCurrentModel()
console.log(currentModel)


chat.switchModel("microsoft/Phi-3.5-mini-instruct")

currentModel = chat.showCurrentModel()
console.log(currentModel)

const currentChat = await chat.getNewChat("you are a drunk person") // optional if you want to set a system prompt
console.log(currentChat)

const tools = await chat.getToolList("1") // for the sake of not overloading the api the tools need to be called when needed also pass the page number more info : https://huggingface.co/chat/tools
console.log(tools)

let data  = await chat.chat("take screenshoot of this website : google.com", undefined, {
	tools:["000000000000000000000001","66e99753cb638fb7e2342da5"], // pass the tools id tools[0].id
	rawResponse:true
}); 

let  reader  =  data.stream.getReader();
while (true) {
	const  {  done,  value  }  =  await  reader.read();
	if (done) break;  // The streaming has ended.
	process.stdout.write(value)
}


data = await chat.chat("what is my name"); 
let response = await data.completeResponsePromise() //non streaming response 
console.log(response)

data = await chat.chat("what is my name", sessons[0].id); // using existing sessons
response = await data.completeResponsePromise()
console.log(response)



```


>Note: Supported in node 18.x and higher.

>Note: In case the package stops working there is most likely a change in hugging face api, if possible please report it and update the package to latest if available.

## Documentations

Full API documentations of both classes can be found here [Chat](./docs/chat.md) [Login](./docs/login.md)


## Contributions

- If you happen to see missing feature or a bug, feel free to open an [issue](https://github.com/rahulsushilsharma/huggingface-chat/issues).
- Pull requests are welcomed too!

## License

[MIT](LICENSE.md)

